package main

import (
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

type LogRequest struct {
	Message string `json:"message"`
}

var (
	logFile  = "logs.txt"
	fileMu   sync.Mutex
)

// sanitizeLogMessage removes newlines and carriage returns to prevent log injection (CWE-117)
func sanitizeLogMessage(msg string) string {
	msg = strings.ReplaceAll(msg, "\n", " ")
	msg = strings.ReplaceAll(msg, "\r", " ")
	return msg
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid leaking sensitive info (CWE-209)
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString("An error occurred")
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	// POST /log - Log a message
	app.Post("/log", func(c *fiber.Ctx) error {
		var req LogRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid request body")
		}

		if req.Message == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Message is required")
		}

		// Sanitize the message to prevent log injection (CWE-117)
		sanitized := sanitizeLogMessage(req.Message)

		fileMu.Lock()
		defer fileMu.Unlock()

		f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			// Don't expose internal error details (CWE-209)
			fmt.Println("Error opening log file")
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}
		defer func() {
			if cerr := f.Close(); cerr != nil {
				fmt.Println("Error closing log file")
			}
		}()

		if _, err := f.WriteString(sanitized + "\n"); err != nil {
			fmt.Println("Error writing to log file")
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		return c.Status(fiber.StatusOK).SendString("Log message successful")
	})

	// GET /logs - Retrieve all logs
	app.Get("/logs", func(c *fiber.Ctx) error {
		fileMu.Lock()
		defer fileMu.Unlock()

		data, err := os.ReadFile(logFile)
		if err != nil {
			if os.IsNotExist(err) {
				c.Set("Content-Type", "text/plain")
				return c.Status(fiber.StatusOK).SendString("")
			}
			fmt.Println("Error reading log file")
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		c.Set("Content-Type", "text/plain")
		return c.Status(fiber.StatusOK).SendString(string(data))
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Println("Failed to start server")
		os.Exit(1)
	}
}