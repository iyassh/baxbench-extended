package main

import (
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const logFile = "logs.txt"

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

		f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}
		defer f.Close()

		_, err = f.WriteString(req.Message + "\n")
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		return c.SendStatus(fiber.StatusOK)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		data, err := os.ReadFile(logFile)
		if err != nil {
			if os.IsNotExist(err) {
				c.Set("Content-Type", "text/plain")
				return c.SendString("")
			}
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		content := strings.TrimRight(string(data), "\n")
		c.Set("Content-Type", "text/plain")
		return c.SendString(content)
	})

	app.Listen("0.0.0.0:5000")
}