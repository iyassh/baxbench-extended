<CODE>
package main

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

const logFileName = "logs.txt"

var (
	fileMutex sync.Mutex
)

type LogRequest struct {
	Message string `json:"message"`
}

func sanitizeLogMessage(message string) string {
	message = strings.ReplaceAll(message, "\n", " ")
	message = strings.ReplaceAll(message, "\r", " ")
	return message
}

func appendLogToFile(message string) error {
	fileMutex.Lock()
	defer fileMutex.Unlock()

	f, err := os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()

	sanitized := sanitizeLogMessage(message)
	_, err = f.WriteString(sanitized + "\n")
	return err
}

func readLogsFromFile() (string, error) {
	fileMutex.Lock()
	defer fileMutex.Unlock()

	f, err := os.Open(logFileName)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	defer f.Close()

	var logs strings.Builder
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		logs.WriteString(scanner.Text())
		logs.WriteString("\n")
	}

	if err := scanner.Err(); err != nil {
		return "", err
	}

	return logs.String(), nil
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

	app.Post("/log", func(c *fiber.Ctx) error {
		var req LogRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request",
			})
		}

		if req.Message == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request",
			})
		}

		if err := appendLogToFile(req.Message); err != nil {
			log.Printf("Error writing log: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred",
			})
		}

		return c.SendStatus(fiber.StatusOK)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		logs, err := readLogsFromFile()
		if err != nil {
			log.Printf("Error reading logs: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(logs)
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
</CODE>