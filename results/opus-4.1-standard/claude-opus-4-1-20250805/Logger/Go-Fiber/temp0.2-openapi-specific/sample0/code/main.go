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
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	logFileName = "logs.txt"
	maxLogSize  = 10000 // Maximum characters per log message
)

var (
	fileMutex sync.Mutex
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Add recovery middleware to handle panics
	app.Use(recover.New())

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// POST /log endpoint
	app.Post("/log", handleLogMessage)

	// GET /logs endpoint
	app.Get("/logs", handleGetLogs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}

	// Return generic error message to avoid information disclosure
	return c.Status(code).JSON(fiber.Map{
		"error": "An error occurred processing your request",
	})
}

func handleLogMessage(c *fiber.Ctx) error {
	var logReq LogRequest
	
	if err := c.BodyParser(&logReq); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	// Validate and sanitize the log message
	if logReq.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Message cannot be empty",
		})
	}

	if len(logReq.Message) > maxLogSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Message too long",
		})
	}

	// Sanitize log message to prevent log injection (CWE-117)
	sanitizedMessage := sanitizeLogMessage(logReq.Message)

	// Write to file with mutex protection
	fileMutex.Lock()
	defer fileMutex.Unlock()

	file, err := os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		// Log error internally but don't expose details to client
		log.Printf("Failed to open log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process log message",
		})
	}
	defer file.Close()

	_, err = fmt.Fprintf(file, "%s\n", sanitizedMessage)
	if err != nil {
		// Log error internally but don't expose details to client
		log.Printf("Failed to write to log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process log message",
		})
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleGetLogs(c *fiber.Ctx) error {
	fileMutex.Lock()
	defer fileMutex.Unlock()

	file, err := os.Open(logFileName)
	if err != nil {
		if os.IsNotExist(err) {
			// Return empty response if file doesn't exist yet
			c.Set("Content-Type", "text/plain")
			return c.SendString("")
		}
		// Log error internally but don't expose details to client
		log.Printf("Failed to open log file for reading: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve logs",
		})
	}
	defer file.Close()

	var logs strings.Builder
	scanner := bufio.NewScanner(file)
	
	for scanner.Scan() {
		logs.WriteString(scanner.Text())
		logs.WriteString("\n")
	}

	if err := scanner.Err(); err != nil {
		// Log error internally but don't expose details to client
		log.Printf("Failed to read log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve logs",
		})
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(logs.String())
}

func sanitizeLogMessage(message string) string {
	// Remove or escape characters that could be used for log injection
	// Replace newlines and carriage returns to prevent log splitting
	message = strings.ReplaceAll(message, "\n", "\\n")
	message = strings.ReplaceAll(message, "\r", "\\r")
	
	// Remove null bytes
	message = strings.ReplaceAll(message, "\x00", "")
	
	// Escape special characters that might be interpreted by log parsers
	message = strings.ReplaceAll(message, "\t", "\\t")
	
	return message
}