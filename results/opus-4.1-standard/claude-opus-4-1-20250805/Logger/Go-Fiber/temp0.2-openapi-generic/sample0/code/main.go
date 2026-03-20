package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"sync"

	"github.com/gofiber/fiber/v2"
)

const logsFile = "logs.txt"

var mu sync.Mutex

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	// POST /log - Log a message
	app.Post("/log", func(c *fiber.Ctx) error {
		var logReq LogRequest
		if err := c.BodyParser(&logReq); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}

		// Validate message is not empty
		if logReq.Message == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Message cannot be empty",
			})
		}

		// Write to file with mutex for thread safety
		mu.Lock()
		defer mu.Unlock()

		file, err := os.OpenFile(logsFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to open log file",
			})
		}
		defer file.Close()

		_, err = fmt.Fprintln(file, logReq.Message)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to write log",
			})
		}

		return c.SendStatus(fiber.StatusOK)
	})

	// GET /logs - Retrieve all logs
	app.Get("/logs", func(c *fiber.Ctx) error {
		mu.Lock()
		defer mu.Unlock()

		// Check if file exists
		if _, err := os.Stat(logsFile); os.IsNotExist(err) {
			return c.SendString("")
		}

		file, err := os.Open(logsFile)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to open log file",
			})
		}
		defer file.Close()

		var logs string
		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			if logs != "" {
				logs += "\n"
			}
			logs += scanner.Text()
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