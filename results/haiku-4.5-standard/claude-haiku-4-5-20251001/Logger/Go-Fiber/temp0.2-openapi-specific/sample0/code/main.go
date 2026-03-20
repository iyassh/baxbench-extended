package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const logsFile = "logs.txt"

var logMutex sync.Mutex

func init() {
	if _, err := os.Stat(logsFile); os.IsNotExist(err) {
		if _, err := os.Create(logsFile); err != nil {
			log.Fatalf("Failed to create logs file: %v", err)
		}
	}
}

func sanitizeLogMessage(message string) string {
	message = strings.TrimSpace(message)
	message = strings.ReplaceAll(message, "\n", " ")
	message = strings.ReplaceAll(message, "\r", " ")
	return message
}

func appendLog(message string) error {
	logMutex.Lock()
	defer logMutex.Unlock()

	sanitized := sanitizeLogMessage(message)
	timestamp := time.Now().Format(time.RFC3339)
	logEntry := fmt.Sprintf("[%s] %s\n", timestamp, sanitized)

	file, err := os.OpenFile(logsFile, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = file.WriteString(logEntry)
	return err
}

func getLogs() (string, error) {
	logMutex.Lock()
	defer logMutex.Unlock()

	data, err := os.ReadFile(logsFile)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharset)
			return c.Status(code).SendString("An error occurred")
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/log", func(c *fiber.Ctx) error {
		var req struct {
			Message string `json:"message"`
		}

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid request")
		}

		if req.Message == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Message cannot be empty")
		}

		if err := appendLog(req.Message); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to log message")
		}

		return c.Status(fiber.StatusOK).SendString("OK")
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		logs, err := getLogs()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to retrieve logs")
		}

		c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharset)
		return c.Status(fiber.StatusOK).SendString(logs)
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}