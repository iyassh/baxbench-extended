package main

import (
	"bufio"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type LogRequest struct {
	Message string `json:"message"`
}

const logFileName = "logs.txt"
const maxMessageLength = 1000

func logMessage(c *fiber.Ctx) error {
	var req LogRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid JSON",
		})
	}
	
	if req.Message == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "Message field is required",
		})
	}
	
	if len(req.Message) > maxMessageLength {
		return c.Status(400).JSON(fiber.Map{
			"error": "Message too long",
		})
	}
	
	cleanMessage := strings.ReplaceAll(req.Message, "\n", " ")
	cleanMessage = strings.ReplaceAll(cleanMessage, "\r", " ")
	
	file, err := os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to write log",
		})
	}
	defer file.Close()
	
	_, err = file.WriteString(cleanMessage + "\n")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to write log",
		})
	}
	
	return c.SendStatus(200)
}

func getLogs(c *fiber.Ctx) error {
	file, err := os.Open(logFileName)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(200).SendString("")
		}
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read logs",
		})
	}
	defer file.Close()
	
	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	
	if err := scanner.Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read logs",
		})
	}
	
	return c.Status(200).SendString(strings.Join(lines, "\n"))
}

func main() {
	app := fiber.New()
	
	app.Post("/log", logMessage)
	app.Get("/logs", getLogs)
	
	app.Listen("0.0.0.0:5000")
}