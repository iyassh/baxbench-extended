package main

import (
	"bufio"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const logFile = "logs.txt"

func main() {
	app := fiber.New()

	app.Post("/log", func(c *fiber.Ctx) error {
		var body struct {
			Message string `json:"message"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid request body")
		}

		message := strings.ReplaceAll(body.Message, "\n", " ")
		message = strings.ReplaceAll(message, "\r", " ")

		f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to open log file")
		}
		defer f.Close()

		if _, err := f.WriteString(message + "\n"); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to write log")
		}

		return c.SendStatus(fiber.StatusOK)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		f, err := os.OpenFile(logFile, os.O_RDONLY|os.O_CREATE, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to open log file")
		}
		defer f.Close()

		var lines []string
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
		}
		if err := scanner.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to read log file")
		}

		c.Set(fiber.HeaderContentType, "text/plain")
		return c.SendString(strings.Join(lines, "\n"))
	})

	app.Listen("0.0.0.0:5000")
}