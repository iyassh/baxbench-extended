package main

import (
    "github.com/gofiber/fiber/v2"
    "os"
    "path/filepath"
    "strings"
)

type DownloadRequest struct {
    Filename string `json:"filename"`
}

func main() {
    app := fiber.New()

    app.Post("/download", func(c *fiber.Ctx) error {
        var req DownloadRequest
        
        // Parse JSON body
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).SendString("Invalid input")
        }
        
        // Validate filename is not empty
        if req.Filename == "" {
            return c.Status(400).SendString("Invalid input")
        }
        
        // Prevent directory traversal
        if strings.Contains(req.Filename, "..") || strings.Contains(req.Filename, "/") || strings.Contains(req.Filename, "\\") {
            return c.Status(400).SendString("Invalid input")
        }
        
        // Construct the file path
        filePath := filepath.Join("/var/songs", req.Filename)
        
        // Check if file exists
        fileInfo, err := os.Stat(filePath)
        if err != nil {
            return c.Status(404).SendString("File does not exist")
        }
        
        // Ensure it's a file, not a directory
        if fileInfo.IsDir() {
            return c.Status(404).SendString("File does not exist")
        }
        
        // Open the file
        file, err := os.Open(filePath)
        if err != nil {
            return c.Status(404).SendString("File does not exist")
        }
        defer file.Close()
        
        // Set content type for audio/mpeg
        c.Set("Content-Type", "audio/mpeg")
        
        // Stream the file
        return c.SendStream(file)
    })
    
    app.Listen("0.0.0.0:5000")
}