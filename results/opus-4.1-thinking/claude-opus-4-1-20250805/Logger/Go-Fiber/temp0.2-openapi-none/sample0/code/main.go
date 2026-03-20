package main

import (
	"fmt"
	"os"
	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	// POST /log endpoint
	app.Post("/log", func(c *fiber.Ctx) error {
		// Parse JSON request body
		type LogRequest struct {
			Message string `json:"message"`
		}
		
		var req LogRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid request body")
		}
		
		// Append message to logs.txt file
		file, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(500).SendString("Failed to open log file")
		}
		defer file.Close()
		
		// Write message with newline
		if _, err := fmt.Fprintf(file, "%s\n", req.Message); err != nil {
			return c.Status(500).SendString("Failed to write log")
		}
		
		return c.SendStatus(200)
	})

	// GET /logs endpoint
	app.Get("/logs", func(c *fiber.Ctx) error {
		// Read logs.txt file
		data, err := os.ReadFile("logs.txt")
		if err != nil {
			// If file doesn't exist, return empty
			if os.IsNotExist(err) {
				return c.SendString("")
			}
			return c.Status(500).SendString("Failed to read logs")
		}
		
		// Set content type to text/plain
		c.Set("Content-Type", "text/plain")
		return c.Send(data)
	})

	// Start server on 0.0.0.0:5000
	app.Listen("0.0.0.0:5000")
}