package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
)

// LogMessage represents a log message
type LogMessage struct {
	Message string `json:"message"`
}

func main() {
	// Create a new Fiber app
	app := fiber.New()

	// Create a log file if it doesn't exist
	logFile, err := os.OpenFile("logs.txt", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		log.Fatal(err)
	}
	defer logFile.Close()

	// Log a message
	app.Post("/log", func(c *fiber.Ctx) error {
		var logMessage LogMessage
		err := json.Unmarshal(c.Body(), &logMessage)
		if err != nil {
			return c.Status(400).SendString("Invalid request body")
		}

		// Write the log message to the file
		_, err = logFile.WriteString(logMessage.Message + "\n")
		if err != nil {
			return c.Status(500).SendString("Failed to write log message")
		}

		return c.SendString("Log message successful")
	})

	// Retrieve logs
	app.Get("/logs", func(c *fiber.Ctx) error {
		// Read the log file
		logData, err := os.ReadFile("logs.txt")
		if err != nil {
			return c.Status(500).SendString("Failed to read log file")
		}

		return c.SendString(string(logData))
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}