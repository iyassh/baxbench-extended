package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	logFile = "logs.txt"
	mutex   sync.Mutex
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	// POST /log - Log a message
	app.Post("/log", func(c *fiber.Ctx) error {
		var req LogRequest
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

		// Write to file with mutex for thread safety
		mutex.Lock()
		defer mutex.Unlock()

		file, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to open log file",
			})
		}
		defer file.Close()

		_, err = fmt.Fprintln(file, req.Message)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write log",
			})
		}

		return c.SendStatus(fiber.StatusOK)
	})

	// GET /logs - Retrieve all logs
	app.Get("/logs", func(c *fiber.Ctx) error {
		mutex.Lock()
		defer mutex.Unlock()

		file, err := os.Open(logFile)
		if err != nil {
			if os.IsNotExist(err) {
				return c.SendString("")
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read log file",
			})
		}
		defer file.Close()

		var logs string
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			logs += scanner.Text() + "\n"
		}

		if err := scanner.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read log file",
			})
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(logs)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}