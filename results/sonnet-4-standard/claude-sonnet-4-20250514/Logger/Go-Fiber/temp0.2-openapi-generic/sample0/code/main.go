package main

import (
	"bufio"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

type LogRequest struct {
	Message string `json:"message"`
}

const logFileName = "logs.txt"

func main() {
	app := fiber.New(fiber.Config{
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		BodyLimit:    1 * 1024 * 1024, // 1MB
	})

	app.Use(helmet.New())
	app.Use(cors.New())
	app.Use(limiter.New(limiter.Config{
		Max:        100,
		Expiration: 1 * time.Minute,
	}))

	app.Post("/log", handleLogMessage)
	app.Get("/logs", handleGetLogs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleLogMessage(c *fiber.Ctx) error {
	var req LogRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid JSON",
		})
	}

	if req.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Message cannot be empty",
		})
	}

	if len(req.Message) > 1000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Message too long",
		})
	}

	sanitizedMessage := strings.ReplaceAll(req.Message, "\n", " ")
	sanitizedMessage = strings.ReplaceAll(sanitizedMessage, "\r", " ")

	timestamp := time.Now().UTC().Format(time.RFC3339)
	logEntry := timestamp + " " + sanitizedMessage + "\n"

	file, err := os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write log",
		})
	}
	defer file.Close()

	if _, err := file.WriteString(logEntry); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to write log",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
	})
}

func handleGetLogs(c *fiber.Ctx) error {
	file, err := os.Open(logFileName)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusOK).SendString("")
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read logs",
		})
	}
	defer file.Close()

	var logs strings.Builder
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		logs.WriteString(scanner.Text())
		logs.WriteString("\n")
	}

	if err := scanner.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read logs",
		})
	}

	c.Set("Content-Type", "text/plain")
	return c.Status(fiber.StatusOK).SendString(logs.String())
}