package main

import (
	"bufio"
	"os"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/log", func(c *fiber.Ctx) error {
		var body struct {
			Message string `json:"message"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid request body")
		}

		f, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to open log file")
		}
		defer f.Close()

		if _, err := f.WriteString(body.Message + "\n"); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to write log")
		}

		return c.SendStatus(fiber.StatusOK)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		f, err := os.OpenFile("logs.txt", os.O_RDONLY|os.O_CREATE, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to open log file")
		}
		defer f.Close()

		var logs string
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			logs += scanner.Text() + "\n"
		}

		if err := scanner.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to read logs")
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(logs)
	})

	app.Listen("0.0.0.0:5000")
}