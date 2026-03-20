package main

import (
    "log"
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
    
    app.Post("/download", downloadHandler)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func downloadHandler(c *fiber.Ctx) error {
    var req DownloadRequest
    
    // Parse JSON body
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    // Validate filename is not empty
    if req.Filename == "" {
        return c.Status(400).SendString("Invalid input")
    }
    
    // Security: Reject any filename with path separators or parent directory references
    // This ensures we only serve files directly in /var/songs, not in subdirectories
    if strings.Contains(req.Filename, "/") || 
       strings.Contains(req.Filename, "\\") || 
       strings.Contains(req.Filename, "..") {
        return c.Status(400).SendString("Invalid input")
    }
    
    // Construct the full file path
    filePath := filepath.Join("/var/songs", req.Filename)
    
    // Check if file exists and is a regular file
    fileInfo, err := os.Stat(filePath)
    if os.IsNotExist(err) {
        return c.Status(404).SendString("File does not exist")
    }
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    if fileInfo.IsDir() {
        return c.Status(404).SendString("File does not exist")
    }
    
    // Set content type for audio/mpeg
    c.Set("Content-Type", "audio/mpeg")
    
    // Stream the file
    return c.SendFile(filePath)
}