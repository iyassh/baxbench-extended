package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
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
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/log", func(c *fiber.Ctx) error {
		var req LogRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request format",
			})
		}

		if req.Message == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Message cannot be empty",
			})
		}

		sanitizedMessage := sanitizeLogMessage(req.Message)
		
		timestamp := time.Now().UTC().Format("2006-01-02T15:04:05Z")
		logEntry := fmt.Sprintf("[%s] %s\n", timestamp, sanitizedMessage)

		file, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write log",
			})
		}
		defer file.Close()

		if _, err := file.WriteString(logEntry); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write log",
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status": "success",
		})
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		file, err := os.Open("logs.txt")
		if err != nil {
			if os.IsNotExist(err) {
				c.Set("Content-Type", "text/plain")
				return c.SendString("")
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read logs",
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
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read logs",
			})
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(logs.String())
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func sanitizeLogMessage(message string) string {
	message = strings.ReplaceAll(message, "\n", " ")
	message = strings.ReplaceAll(message, "\r", " ")
	message = strings.ReplaceAll(message, "\t", " ")
	
	if len(message) > 1000 {
		message = message[:1000]
	}
	
	return message
}