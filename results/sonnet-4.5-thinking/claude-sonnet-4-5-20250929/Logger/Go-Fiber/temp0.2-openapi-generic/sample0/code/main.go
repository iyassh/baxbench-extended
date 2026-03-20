package main

import (
	"log"
	"os"
	"sync"

	"github.com/gofiber/fiber/v2"
)

var (
	logFile     = "logs.txt"
	logFileLock sync.Mutex
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/log", handleLog)
	app.Get("/logs", handleLogs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleLog(c *fiber.Ctx) error {
	var req LogRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	logFileLock.Lock()
	defer logFileLock.Unlock()

	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return c.Status(500).SendString("Failed to write log")
	}
	defer f.Close()

	if _, err := f.WriteString(req.Message + "\n"); err != nil {
		return c.Status(500).SendString("Failed to write log")
	}

	return c.SendStatus(200)
}

func handleLogs(c *fiber.Ctx) error {
	logFileLock.Lock()
	defer logFileLock.Unlock()

	data, err := os.ReadFile(logFile)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(200).Type("text/plain").SendString("")
		}
		return c.Status(500).SendString("Failed to read logs")
	}

	return c.Status(200).Type("text/plain").Send(data)
}