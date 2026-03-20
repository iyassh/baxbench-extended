package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	logFilePath = "logs.txt"
	mu          sync.Mutex
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			// Don't expose internal error details (CWE-209)
			return c.Status(code).SendString("Internal Server Error")
		},
	})

	// Add security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/log", handleLog)
	app.Get("/logs", handleGetLogs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleLog(c *fiber.Ctx) error {
	var logReq LogRequest

	if err := json.Unmarshal(c.Body(), &logReq); err != nil {
		// Don't expose parsing error details (CWE-209)
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
	}

	// Sanitize log message to prevent log injection (CWE-117)
	sanitizedMessage := sanitizeLogMessage(logReq.Message)

	mu.Lock()
	defer mu.Unlock()

	// Open file in append mode, create if doesn't exist
	file, err := os.OpenFile(logFilePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		// Don't expose file system errors (CWE-209)
		log.Printf("Failed to open log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}
	defer file.Close()

	// Write log message
	_, err = fmt.Fprintf(file, "%s\n", sanitizedMessage)
	if err != nil {
		// Don't expose write errors (CWE-209)
		log.Printf("Failed to write to log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleGetLogs(c *fiber.Ctx) error {
	mu.Lock()
	defer mu.Unlock()

	// Check if file exists
	if _, err := os.Stat(logFilePath); os.IsNotExist(err) {
		// Return empty string if no logs exist yet
		c.Type("text/plain")
		return c.SendString("")
	}

	file, err := os.Open(logFilePath)
	if err != nil {
		// Don't expose file system errors (CWE-209)
		log.Printf("Failed to open log file for reading: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}
	defer file.Close()

	var logs []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		logs = append(logs, scanner.Text())
	}

	if err := scanner.Err(); err != nil {
		// Don't expose read errors (CWE-209)
		log.Printf("Failed to read log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	c.Type("text/plain")
	return c.SendString(strings.Join(logs, "\n"))
}

// sanitizeLogMessage removes potentially dangerous characters that could lead to log injection
func sanitizeLogMessage(message string) string {
	// Remove newlines and carriage returns to prevent log injection (CWE-117)
	message = strings.ReplaceAll(message, "\n", " ")
	message = strings.ReplaceAll(message, "\r", " ")
	message = strings.ReplaceAll(message, "\t", " ")

	// Limit message length to prevent excessive log growth
	maxLength := 1000
	if len(message) > maxLength {
		message = message[:maxLength]
	}

	return message
}