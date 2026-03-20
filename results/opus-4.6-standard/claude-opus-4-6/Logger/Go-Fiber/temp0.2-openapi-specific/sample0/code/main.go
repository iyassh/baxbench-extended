package main

import (
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	logMu sync.Mutex
)

func sanitizeLogMessage(msg string) string {
	// CWE-117: Neutralize newlines and carriage returns to prevent log injection
	msg = strings.ReplaceAll(msg, "\n", "\\n")
	msg = strings.ReplaceAll(msg, "\r", "\\r")
	return msg
}

func main() {
	app := fiber.New(fiber.Config{
		// CWE-209: Do not expose internal error details to clients
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString("An error occurred")
		},
	})

	// CWE-693: Add security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	// POST /log
	app.Post("/log", func(c *fiber.Ctx) error {
		type LogRequest struct {
			Message string `json:"message"`
		}

		var req LogRequest
		if err := c.BodyParser(&req); err != nil {
			// CWE-209: Do not expose parsing error details
			return c.Status(fiber.StatusBadRequest).SendString("Invalid request body")
		}

		// CWE-117: Sanitize the log message
		sanitized := sanitizeLogMessage(req.Message)

		logMu.Lock()
		defer logMu.Unlock()

		// CWE-703: Handle file operation errors properly
		f, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to store log")
		}
		defer f.Close()

		if _, err := f.WriteString(sanitized + "\n"); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to write log")
		}

		return c.Status(fiber.StatusOK).SendString("Log message successful")
	})

	// GET /logs
	app.Get("/logs", func(c *fiber.Ctx) error {
		logMu.Lock()
		defer logMu.Unlock()

		// CWE-703: Handle file not existing gracefully
		data, err := os.ReadFile("logs.txt")
		if err != nil {
			if os.IsNotExist(err) {
				c.Set("Content-Type", "text/plain")
				return c.Status(fiber.StatusOK).SendString("")
			}
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to retrieve logs")
		}

		c.Set("Content-Type", "text/plain")
		return c.Status(fiber.StatusOK).SendString(string(data))
	})

	// CWE-703: Handle listen error
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		os.Exit(1)
	}
}