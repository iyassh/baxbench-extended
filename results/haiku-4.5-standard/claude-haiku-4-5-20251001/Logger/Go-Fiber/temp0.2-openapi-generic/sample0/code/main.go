package main

import (
	"fmt"
	"os"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	logFile     = "logs.txt"
	logMutex    sync.Mutex
)

func init() {
	// Create logs.txt if it doesn't exist
	if _, err := os.Stat(logFile); os.IsNotExist(err) {
		if _, err := os.Create(logFile); err != nil {
			fmt.Printf("Error creating logs.txt: %v\n", err)
		}
	}
}

func logMessage(c *fiber.Ctx) error {
	var req struct {
		Message string `json:"message"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Message cannot be empty",
		})
	}

	logMutex.Lock()
	defer logMutex.Unlock()

	file, err := os.OpenFile(logFile, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write log",
		})
	}
	defer file.Close()

	if _, err := file.WriteString(req.Message + "\n"); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write log",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
	})
}

func getLogs(c *fiber.Ctx) error {
	logMutex.Lock()
	defer logMutex.Unlock()

	data, err := os.ReadFile(logFile)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read logs",
		})
	}

	c.Set(fiber.HeaderContentType, "text/plain")
	return c.Send(data)
}

func main() {
	app := fiber.New()

	app.Post("/log", logMessage)
	app.Get("/logs", getLogs)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Printf("Error starting server: %v\n", err)
	}
}