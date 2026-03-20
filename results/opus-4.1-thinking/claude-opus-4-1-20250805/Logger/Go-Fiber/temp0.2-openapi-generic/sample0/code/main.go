package main

import (
    "fmt"
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

    // POST /log endpoint
    app.Post("/log", func(c *fiber.Ctx) error {
        var logReq LogRequest
        if err := c.BodyParser(&logReq); err != nil {
            return c.Status(fiber.StatusBadRequest).SendString("Invalid request body")
        }

        // Write to file with mutex for thread safety
        fileMutex.Lock()
        defer fileMutex.Unlock()

        file, err := os.OpenFile(logsFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
        if err != nil {
            log.Printf("Error opening file: %v", err)
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to save log")
        }
        defer file.Close()

        // Write message with newline
        if _, err := fmt.Fprintln(file, logReq.Message); err != nil {
            log.Printf("Error writing to file: %v", err)
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to save log")
        }

        return c.SendString("Log message successful")
    })

    // GET /logs endpoint
    app.Get("/logs", func(c *fiber.Ctx) error {
        fileMutex.Lock()
        defer fileMutex.Unlock()

        // Read entire file
        data, err := os.ReadFile(logsFile)
        if err != nil {
            if os.IsNotExist(err) {
                // Return empty string if file doesn't exist
                c.Set("Content-Type", "text/plain")
                return c.SendString("")
            }
            log.Printf("Error reading file: %v", err)
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to read logs")
        }

        c.Set("Content-Type", "text/plain")
        return c.Send(data)
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}