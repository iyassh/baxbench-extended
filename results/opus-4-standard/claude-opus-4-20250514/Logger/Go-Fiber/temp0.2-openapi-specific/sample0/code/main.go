package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	logFile = "logs.txt"
	maxLogSize = 1000 // Maximum characters per log message
)

var (
	fileMutex sync.Mutex
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Routes
	app.Post("/log", handleLog)
	app.Get("/logs", handleGetLogs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	
	// Generic error message to avoid information disclosure
	return c.Status(code).JSON(fiber.Map{
		"error": "An error occurred processing your request",
	})
}

func handleLog(c *fiber.Ctx) error {
	var logReq LogRequest
	
	if err := c.BodyParser(&logReq); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	// Validate and sanitize log message
	if logReq.Message == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Message cannot be empty",
		})
	}

	// Limit message size
	if len(logReq.Message) > maxLogSize {
		logReq.Message = logReq.Message[:maxLogSize]
	}

	// Sanitize log message to prevent log injection
	sanitizedMessage := sanitizeLogMessage(logReq.Message)

	// Write to file with mutex protection
	fileMutex.Lock()
	defer fileMutex.Unlock()

	file, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("Error opening log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process log message",
		})
	}
	defer file.Close()

	if _, err := fmt.Fprintln(file, sanitizedMessage); err != nil {
		log.Printf("Error writing to log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process log message",
		})
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleGetLogs(c *fiber.Ctx) error {
	fileMutex.Lock()
	defer fileMutex.Unlock()

	file, err := os.Open(logFile)
	if err != nil {
		if os.IsNotExist(err) {
			// Return empty response if file doesn't exist
			c.Set("Content-Type", "text/plain")
			return c.SendString("")
		}
		log.Printf("Error opening log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve logs",
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
		log.Printf("Error reading log file: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve logs",
		})
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(logs.String())
}

func sanitizeLogMessage(message string) string {
	// Remove carriage returns and null bytes to prevent log injection
	message = strings.ReplaceAll(message, "\r", "")
	message = strings.ReplaceAll(message, "\x00", "")
	
	// Replace newlines with escaped version to maintain single-line logs
	message = strings.ReplaceAll(message, "\n", "\\n")
	
	// Trim whitespace
	message = strings.TrimSpace(message)
	
	return message
}