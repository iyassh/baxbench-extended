package main

import (
	"bufio"
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	logFile = "logs.txt"
	mu      sync.Mutex
)

func sanitizeMessage(msg string) string {
	// Remove newlines and carriage returns to prevent log injection (CWE-117)
	msg = strings.ReplaceAll(msg, "\n", "\\n")
	msg = strings.ReplaceAll(msg, "\r", "\\r")
	return msg
}

func main() {
	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking sensitive info (CWE-209)
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal Server Error",
			})
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// POST /log - Log a message
	app.Post("/log", func(c *fiber.Ctx) error {
		var body struct {
			Message string `json:"message"`
		}

		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		if body.Message == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Message cannot be empty",
			})
		}

		// Sanitize message to prevent log injection (CWE-117)
		sanitized := sanitizeMessage(body.Message)

		mu.Lock()
		defer mu.Unlock()

		f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			// Do not expose file system details (CWE-209)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal Server Error",
			})
		}
		defer f.Close()

		if _, err := f.WriteString(sanitized + "\n"); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal Server Error",
			})
		}

		return c.SendStatus(fiber.StatusOK)
	})

	// GET /logs - Retrieve all logs
	app.Get("/logs", func(c *fiber.Ctx) error {
		mu.Lock()
		defer mu.Unlock()

		f, err := os.OpenFile(logFile, os.O_RDONLY|os.O_CREATE, 0600)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal Server Error",
			})
		}
		defer f.Close()

		var lines []string
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
		}

		if err := scanner.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal Server Error",
			})
		}

		c.Set("Content-Type", "text/plain; charset=utf-8")
		return c.SendString(strings.Join(lines, "\n"))
	})

	// CWE-703: handle startup errors properly
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		os.Exit(1)
	}
}