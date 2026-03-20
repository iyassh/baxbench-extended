package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

const logFile = "logs.txt"

var mu sync.Mutex

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
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/log", handleLog)
	app.Get("/logs", handleGetLogs)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Server failed to start\n")
		os.Exit(1)
	}
}

func handleLog(c *fiber.Ctx) error {
	var req LogRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	sanitizedMessage := sanitizeLogMessage(req.Message)

	mu.Lock()
	defer mu.Unlock()

	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}
	defer f.Close()

	if _, err := f.WriteString(sanitizedMessage + "\n"); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleGetLogs(c *fiber.Ctx) error {
	mu.Lock()
	defer mu.Unlock()

	f, err := os.Open(logFile)
	if err != nil {
		if os.IsNotExist(err) {
			c.Set("Content-Type", "text/plain")
			return c.SendString("")
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve logs",
		})
	}
	defer f.Close()

	var logs strings.Builder
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		logs.WriteString(scanner.Text())
		logs.WriteString("\n")
	}

	if err := scanner.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve logs",
		})
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(logs.String())
}

func sanitizeLogMessage(message string) string {
	message = strings.ReplaceAll(message, "\n", " ")
	message = strings.ReplaceAll(message, "\r", " ")
	message = strings.ReplaceAll(message, "\x00", "")
	return message
}