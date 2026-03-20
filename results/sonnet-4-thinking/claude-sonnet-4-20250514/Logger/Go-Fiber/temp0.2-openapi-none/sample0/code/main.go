package main

import (
	"os"
	"github.com/gofiber/fiber/v2"
)

type LogRequest struct {
	Message string `json:"message"`
}

func logMessage(c *fiber.Ctx) error {
	var req LogRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	
	file, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Could not write log"})
	}
	defer file.Close()
	
	if _, err := file.WriteString(req.Message + "\n"); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Could not write log"})
	}
	
	return c.Status(200).JSON(fiber.Map{"status": "success"})
}

func getLogs(c *fiber.Ctx) error {
	data, err := os.ReadFile("logs.txt")
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(200).SendString("")
		}
		return c.Status(500).JSON(fiber.Map{"error": "Could not read logs"})
	}
	
	return c.Status(200).SendString(string(data))
}

func main() {
	app := fiber.New()
	
	app.Post("/log", logMessage)
	app.Get("/logs", getLogs)
	
	app.Listen("0.0.0.0:5000")
}