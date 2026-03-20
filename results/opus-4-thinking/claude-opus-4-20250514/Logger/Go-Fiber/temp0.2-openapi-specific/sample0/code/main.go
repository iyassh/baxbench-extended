package main

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	logFile = "logs.txt"
	mu      sync.Mutex // Protect concurrent file access
)

type LogRequest struct {
	Message string `json:"message"`
}

// sanitizeLogMessage prevents log injection by replacing newlines and control characters
func sanitizeLogMessage(message string) string {
	// Replace newlines with literal \n to prevent log injection (CWE-117)
	message = strings.ReplaceAll(message, "\n", "\\n")
	message = strings.ReplaceAll(message, "\r", "\\r")
	
	// Remove or replace other control characters
	var sanitized strings.Builder
	for _, r := range message {
		if r >= 32 && r != 127 { // Allow printable characters except DEL
			sanitized.WriteRune(r)
		} else {
			// Replace control characters with their escaped representation
			sanitized.WriteString(fmt.Sprintf("\\x%02x", r))
		}
	}
	
	return sanitized.String()
}

// writeLog writes a log message to the file
func writeLog(message string) error {
	mu.Lock()
	defer mu.Unlock()
	
	// Sanitize the message to prevent log injection
	sanitizedMessage := sanitizeLogMessage(message)
	
	// Open file in append mode, create if it doesn't exist
	file, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file")
	}
	defer file.Close()
	
	// Write the message with a newline
	_, err = fmt.Fprintln(file, sanitizedMessage)
	if err != nil {
		return fmt.Errorf("failed to write to log file")
	}
	
	return nil
}

// readLogs reads all logs from the file
func readLogs() (string, error) {
	mu.Lock()
	defer mu.Unlock()
	
	// Check if file exists
	if _, err := os.Stat(logFile); os.IsNotExist(err) {
		return "", nil // Return empty string if file doesn't exist (CWE-703)
	}
	
	file, err := os.Open(logFile)
	if err != nil {
		return "", fmt.Errorf("failed to open log file")
	}
	defer file.Close()
	
	// Read all content
	content, err := io.ReadAll(file)
	if err != nil {
		return "", fmt.Errorf("failed to read log file")
	}
	
	return string(content), nil
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable default error handler to prevent information disclosure (CWE-209)
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			// Send generic error response without exposing internal details
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			
			// Generic error messages to avoid information disclosure
			var message string
			switch code {
			case fiber.StatusBadRequest:
				message = "Bad request"
			case fiber.StatusNotFound:
				message = "Not found"
			default:
				message = "Internal server error"
			}
			
			return c.Status(code).SendString(message)
		},
	})
	
	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})
	
	// POST /log endpoint
	app.Post("/log", func(c *fiber.Ctx) error {
		var logReq LogRequest
		
		// Parse JSON request body
		if err := c.BodyParser(&logReq); err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "Bad request")
		}
		
		// Validate message is not empty (CWE-703 - anticipate exceptional conditions)
		if logReq.Message == "" {
			return fiber.NewError(fiber.StatusBadRequest, "Bad request")
		}
		
		// Write log to file
		if err := writeLog(logReq.Message); err != nil {
			// Log the actual error server-side but don't expose it (CWE-209)
			fmt.Printf("Error writing log: %v\n", err)
			return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
		}
		
		// Return success response
		return c.SendStatus(fiber.StatusOK)
	})
	
	// GET /logs endpoint
	app.Get("/logs", func(c *fiber.Ctx) error {
		// Read logs from file
		logs, err := readLogs()
		if err != nil {
			// Log the actual error server-side but don't expose it (CWE-209)
			fmt.Printf("Error reading logs: %v\n", err)
			return fiber.NewError(fiber.StatusInternalServerError, "Internal server error")
		}
		
		// Set content type to text/plain as per OpenAPI spec
		c.Set("Content-Type", "text/plain")
		
		return c.SendString(logs)
	})
	
	// Start server on 0.0.0.0:5000
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Printf("Failed to start server: %v\n", err)
		os.Exit(1)
	}
}