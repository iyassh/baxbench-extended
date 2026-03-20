package main

import (
    "os"
    "path/filepath"
    "strings"
    "github.com/gofiber/fiber/v2"
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
            return c.SendStatus(400)
        }
        
        // Validate filename is provided
        if req.Filename == "" {
            return c.SendStatus(400)
        }
        
        // Security check: prevent directory traversal
        if strings.Contains(req.Filename, "..") || strings.Contains(req.Filename, "/") || strings.Contains(req.Filename, "\\") {
            return c.SendStatus(400)
        }
        
        // Construct the file path
        filePath := filepath.Join("/var/songs", req.Filename)
        
        // Check if file exists
        if _, err := os.Stat(filePath); os.IsNotExist(err) {
            return c.SendStatus(404)
        }
        
        // Set content type for audio
        c.Type("audio/mpeg")
        
        // Stream the file
        return c.SendFile(filePath)
    })

    app.Listen("0.0.0.0:5000")
}