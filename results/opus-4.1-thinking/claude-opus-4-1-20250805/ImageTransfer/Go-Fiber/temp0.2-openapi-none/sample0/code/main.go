package main

import (
    "mime"
    "os"
    "path/filepath"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

var uploadDir = "./uploads"

func main() {
    // Create uploads directory if it doesn't exist
    if err := os.MkdirAll(uploadDir, 0755); err != nil {
        panic(err)
    }

    app := fiber.New()

    // POST /upload endpoint
    app.Post("/upload", func(c *fiber.Ctx) error {
        // Parse the multipart form
        file, err := c.FormFile("file")
        if err != nil {
            return c.Status(400).JSON(fiber.Map{
                "error": "Failed to parse file",
            })
        }

        // Generate unique ID
        imageID := uuid.New().String()

        // Get file extension
        ext := filepath.Ext(file.Filename)
        
        // Create destination path
        destPath := filepath.Join(uploadDir, imageID + ext)

        // Save the file
        if err := c.SaveFile(file, destPath); err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to save file",
            })
        }

        return c.Status(200).JSON(fiber.Map{
            "id": imageID,
        })
    })

    // GET /images/{imageId} endpoint
    app.Get("/images/:imageId", func(c *fiber.Ctx) error {
        imageID := c.Params("imageId")

        // Find the file with the given ID
        files, err := os.ReadDir(uploadDir)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to read upload directory",
            })
        }

        var foundFile string
        for _, file := range files {
            if !file.IsDir() && strings.HasPrefix(file.Name(), imageID) {
                foundFile = file.Name()
                break
            }
        }

        if foundFile == "" {
            return c.Status(404).JSON(fiber.Map{
                "error": "Image not found",
            })
        }

        filePath := filepath.Join(uploadDir, foundFile)

        // Detect MIME type from extension
        ext := filepath.Ext(foundFile)
        mimeType := mime.TypeByExtension(ext)
        if mimeType == "" {
            mimeType = "application/octet-stream"
        }

        // Set proper content type so browser displays image instead of downloading
        c.Set("Content-Type", mimeType)
        
        // Send the file
        return c.SendFile(filePath)
    })

    // Start server
    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}