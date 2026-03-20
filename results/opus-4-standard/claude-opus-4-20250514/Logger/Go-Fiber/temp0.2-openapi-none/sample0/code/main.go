package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const logsFile = "logs.txt"

func main() {
	app := fiber.New()

	// POST /log - Log a message
	app.Post("/log", func(c *fiber.Ctx) error {
		var body struct {
			Message string `json:"message"`
		}

		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		// Open file in append mode, create if doesn't exist
		file, err := os.OpenFile(logsFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to open log file",
			})
		}
		defer file.Close()

		// Write the message to file
		_, err = file.WriteString(body.Message + "\n")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write log",
			})
		}

		return c.SendStatus(fiber.StatusOK)
	})

	// GET /logs - Retrieve all logs
	app.Get("/logs", func(c *fiber.Ctx) error {
		// Check if file exists
		if _, err := os.Stat(logsFile); os.IsNotExist(err) {
			return c.SendString("")
		}

		// Open file for reading
		file, err := os.Open(logsFile)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to open log file",
			})
		}
		defer file.Close()

		// Read all lines
		var logs []string
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			logs = append(logs, scanner.Text())
		}

		if err := scanner.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read log file",
			})
		}

		// Return logs as plain text
		c.Set("Content-Type", "text/plain")
		return c.SendString(strings.Join(logs, "\n"))
	})

	fmt.Println("Server starting on 0.0.0.0:5000")
	app.Listen("0.0.0.0:5000")
}