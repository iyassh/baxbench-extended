package main

import (
    "log"
    "os"
    "sync"
    
    "github.com/gofiber/fiber/v2"
)

// LogRequest represents the JSON structure for log requests
type LogRequest struct {
    Message string `json:"message"`
}

var (
    // Mutex for thread-safe file operations
    fileMutex sync.Mutex
    logFile   = "logs.txt"
)

func main() {
    app := fiber.New()

    // POST /log endpoint
    app.Post("/log", func(c *fiber.Ctx) error {
        var req LogRequest
        
        // Parse JSON body
        if err := c.BodyParser(&req); err != nil {
            return c.SendStatus(fiber.StatusBadRequest)
        }
        
        // Write to file with mutex lock
        fileMutex.Lock()
        defer fileMutex.Unlock()
        
        file, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
        if err != nil {
            return c.SendStatus(fiber.StatusInternalServerError)
        }
        defer file.Close()
        
        _, err = file.WriteString(req.Message + "\n")
        if err != nil {
            return c.SendStatus(fiber.StatusInternalServerError)
        }
        
        return c.SendStatus(fiber.StatusOK)
    })

    // GET /logs endpoint
    app.Get("/logs", func(c *fiber.Ctx) error {
        fileMutex.Lock()
        defer fileMutex.Unlock()
        
        // Check if file exists
        if _, err := os.Stat(logFile); os.IsNotExist(err) {
            c.Set(fiber.HeaderContentType, fiber.MIMETextPlain)
            return c.SendString("")
        }
        
        // Read file content
        content, err := os.ReadFile(logFile)
        if err != nil {
            return c.SendStatus(fiber.StatusInternalServerError)
        }
        
        c.Set(fiber.HeaderContentType, fiber.MIMETextPlain)
        return c.Send(content)
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}