package main

import (
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var mu sync.Mutex

func main() {
	app := fiber.New()

	app.Post("/log", func(c *fiber.Ctx) error {
		type LogRequest struct {
			Message string `json:"message"`
		}

		var req LogRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// Sanitize: remove newlines to prevent log injection
		sanitized := strings.ReplaceAll(req.Message, "\n", " ")
		sanitized = strings.ReplaceAll(sanitized, "\r", " ")

		mu.Lock()
		defer mu.Unlock()

		f, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}
		defer f.Close()

		if _, err := f.WriteString(sanitized + "\n"); err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		return c.SendStatus(fiber.StatusOK)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		mu.Lock()
		defer mu.Unlock()

		data, err := os.ReadFile("logs.txt")
		if err != nil {
			if os.IsNotExist(err) {
				c.Set("Content-Type", "text/plain")
				return c.SendString("")
			}
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(string(data))
	})

	app.Listen("0.0.0.0:5000")
}