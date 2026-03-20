<CODE>
package main

import (
	"log"
	"os"
	"sync"

	"github.com/gofiber/fiber/v2"
)

const logFileName = "logs.txt"

var (
	fileMutex sync.Mutex
)

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/log", handleLogMessage)
	app.Get("/logs", handleGetLogs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleLogMessage(c *fiber.Ctx) error {
	var req LogRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid request body")
	}

	fileMutex.Lock()
	defer fileMutex.Unlock()

	f, err := os.OpenFile(logFileName, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to open log file")
	}
	defer f.Close()

	if _, err := f.WriteString(req.Message + "\n"); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to write log")
	}

	return c.SendStatus(fiber.StatusOK)
}

func handleGetLogs(c *fiber.Ctx) error {
	fileMutex.Lock()
	defer fileMutex.Unlock()

	data, err := os.ReadFile(logFileName)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Type("text/plain").SendString("")
		}
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to read logs")
	}

	return c.Type("text/plain").Send(data)
}
</CODE>