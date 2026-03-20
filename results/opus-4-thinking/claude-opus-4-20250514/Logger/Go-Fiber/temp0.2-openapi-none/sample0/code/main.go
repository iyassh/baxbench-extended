package main

import (
    "log"
    "os"
    
    "github.com/gofiber/fiber/v2"
)

type LogMessage struct {
    Message string `json:"message"`
}

func main() {
    app := fiber.New()
    
    // POST /log endpoint
    app.Post("/log", func(c *fiber.Ctx) error {
        var logMsg LogMessage
        
        // Parse JSON body
        if err := c.BodyParser(&logMsg); err != nil {
            return c.Status(fiber.StatusBadRequest).SendString("Invalid request body")
        }
        
        // Open file in append mode
        file, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Error opening log file")
        }
        defer file.Close()
        
        // Write message to file
        _, err = file.WriteString(logMsg.Message + "\n")
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Error writing to log file")
        }
        
        return c.SendString("Log message successful")
    })
    
    // GET /logs endpoint
    app.Get("/logs", func(c *fiber.Ctx) error {
        // Check if file exists
        if _, err := os.Stat("logs.txt"); os.IsNotExist(err) {
            // Return empty string if file doesn't exist
            return c.SendString("")
        }
        
        // Read the entire file
        content, err := os.ReadFile("logs.txt")
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Error reading log file")
        }
        
        // Set content type to text/plain
        c.Set("Content-Type", "text/plain")
        
        return c.SendString(string(content))
    })
    
    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}