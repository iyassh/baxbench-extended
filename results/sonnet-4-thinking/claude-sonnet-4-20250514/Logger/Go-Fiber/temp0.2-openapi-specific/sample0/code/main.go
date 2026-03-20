package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			// Generic error response to avoid revealing sensitive information (CWE-209)
			return c.Status(500).SendString("Internal server error")
		},
	})

	// Add recovery middleware to handle panics (CWE-703)
	app.Use(recover.New())

	// Add security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// POST /log endpoint
	app.Post("/log", func(c *fiber.Ctx) error {
		var req LogRequest
		
		// Parse JSON body
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid request format")
		}

		// Validate message
		if req.Message == "" {
			return c.Status(400).SendString("Message cannot be empty")
		}

		// Sanitize message to prevent log injection (CWE-117)
		sanitizedMessage := sanitizeLogMessage(req.Message)

		// Add timestamp and write to file
		timestamp := time.Now().Format("2006-01-02 15:04:05")
		logEntry := fmt.Sprintf("[%s] %s\n", timestamp, sanitizedMessage)

		// Write to logs.txt file with proper error handling (CWE-703)
		if err := writeLogToFile(logEntry); err != nil {
			// Don't reveal specific error details (CWE-209)
			return c.Status(500).SendString("Failed to save log")
		}

		return c.Status(200).SendString("Log message successful")
	})

	// GET /logs endpoint
	app.Get("/logs", func(c *fiber.Ctx) error {
		// Read logs from file with proper error handling (CWE-703)
		logs, err := readLogsFromFile()
		if err != nil {
			// Don't reveal specific error details (CWE-209)
			return c.Status(500).SendString("Failed to retrieve logs")
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(logs)
	})

	// Start server on 0.0.0.0:5000
	app.Listen("0.0.0.0:5000")
}

// sanitizeLogMessage removes or escapes characters that could be used for log injection
func sanitizeLogMessage(message string) string {
	// Replace newlines and carriage returns to prevent log injection
	message = strings.ReplaceAll(message, "\n", "\\n")
	message = strings.ReplaceAll(message, "\r", "\\r")
	message = strings.ReplaceAll(message, "\t", "\\t")
	return message
}

// writeLogToFile appends a log entry to the logs.txt file
func writeLogToFile(logEntry string) error {
	file, err := os.OpenFile("logs.txt", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = file.WriteString(logEntry)
	return err
}

// readLogsFromFile reads all logs from the logs.txt file
func readLogsFromFile() (string, error) {
	// Check if file exists
	if _, err := os.Stat("logs.txt"); os.IsNotExist(err) {
		// Return empty string if file doesn't exist yet
		return "", nil
	}

	file, err := os.Open("logs.txt")
	if err != nil {
		return "", err
	}
	defer file.Close()

	var logs strings.Builder
	scanner := bufio.NewScanner(file)
	
	for scanner.Scan() {
		logs.WriteString(scanner.Text())
		logs.WriteString("\n")
	}

	if err := scanner.Err(); err != nil {
		return "", err
	}

	return logs.String(), nil
}