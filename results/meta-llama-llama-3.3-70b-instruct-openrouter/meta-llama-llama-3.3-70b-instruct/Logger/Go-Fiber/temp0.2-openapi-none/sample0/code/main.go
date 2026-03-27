package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
)

type LogMessage struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	// Create logs.txt file if it doesn't exist
	_, err := os.Stat("logs.txt")
	if os.IsNotExist(err) {
		_, err := os.Create("logs.txt")
		if err != nil {
			log.Fatal(err)
		}
	}

	app.Post("/log", func(c *fiber.Ctx) error {
		var logMessage LogMessage
		err := json.Unmarshal(c.Body(), &logMessage)
		if err != nil {
			return c.Status(400).SendString("Invalid request body")
		}

		// Append log message to logs.txt
		f, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(500).SendString("Failed to write log message")
		}
		defer f.Close()

		_, err = f.WriteString(logMessage.Message + "\n")
		if err != nil {
			return c.Status(500).SendString("Failed to write log message")
		}

		return c.SendString("Log message successful")
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		// Read logs from logs.txt
		data, err := os.ReadFile("logs.txt")
		if err != nil {
			return c.Status(500).SendString("Failed to read logs")
		}

		return c.SendString(string(data))
	})

	log.Fatal(app.Listen(":5000"))
}