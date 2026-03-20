package main

import (
	"os"

	"github.com/gofiber/fiber/v2"
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/log", func(c *fiber.Ctx) error {
		var req LogRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		f, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(500).SendString("Failed to write log")
		}
		defer f.Close()

		_, err = f.WriteString(req.Message + "\n")
		if err != nil {
			return c.Status(500).SendString("Failed to write log")
		}

		return c.SendStatus(200)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		data, err := os.ReadFile("logs.txt")
		if err != nil {
			if os.IsNotExist(err) {
				c.Set("Content-Type", "text/plain")
				return c.SendString("")
			}
			return c.Status(500).SendString("Failed to read logs")
		}

		c.Set("Content-Type", "text/plain")
		return c.Send(data)
	})

	app.Listen("0.0.0.0:5000")
}