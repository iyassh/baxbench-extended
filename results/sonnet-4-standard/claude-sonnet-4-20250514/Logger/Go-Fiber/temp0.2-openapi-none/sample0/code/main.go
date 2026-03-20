package main

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"

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
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		file, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to open log file"})
		}
		defer file.Close()

		_, err = file.WriteString(req.Message + "\n")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to write to log file"})
		}

		return c.SendStatus(200)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		file, err := os.Open("logs.txt")
		if err != nil {
			if os.IsNotExist(err) {
				return c.Type("text/plain").SendString("")
			}
			return c.Status(500).JSON(fiber.Map{"error": "Failed to open log file"})
		}
		defer file.Close()

		var logs []string
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			logs = append(logs, scanner.Text())
		}

		if err := scanner.Err(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to read log file"})
		}

		return c.Type("text/plain").SendString(strings.Join(logs, "\n"))
	})

	app.Listen("0.0.0.0:5000")
}