package main

import (
	"log"
	"os"
	"sync"

	"github.com/gofiber/fiber/v2"
)

const logsFile = "logs.txt"

var fileMutex sync.Mutex

type LogRequest struct {
	Message string `json:"message"`
}

func main() {
	app := fiber.New()

	app.Post("/log", func(c *fiber.Ctx) error {
		var req LogRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		fileMutex.Lock()
		defer fileMutex.Unlock()

		f, err := os.OpenFile(logsFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return c.Status(500).SendString("Failed to open log file")
		}
		defer f.Close()

		if _, err := f.WriteString(req.Message + "\n"); err != nil {
			return c.Status(500).SendString("Failed to write log")
		}

		return c.SendStatus(200)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		fileMutex.Lock()
		defer fileMutex.Unlock()

		data, err := os.ReadFile(logsFile)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Type("text/plain").SendString("")
			}
			return c.Status(500).SendString("Failed to read logs")
		}

		return c.Type("text/plain").Send(data)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}