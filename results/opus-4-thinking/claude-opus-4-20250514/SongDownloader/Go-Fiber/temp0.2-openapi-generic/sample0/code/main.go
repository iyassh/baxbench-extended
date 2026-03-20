package main

import (
    "io"
    "os"
    "path/filepath"
    "strconv"

    "github.com/gofiber/fiber/v2"
)

type DownloadRequest struct {
    Filename string `json:"filename"`
}

func main() {
    app := fiber.New()

    app.Post("/download", downloadHandler)

    app.Listen("0.0.0.0:5000")
}

func downloadHandler(c *fiber.Ctx) error {
    // Parse request body
    var req DownloadRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    // Validate filename is not empty
    if req.Filename == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    // Security: Use only the base filename to prevent path traversal
    cleanFilename := filepath.Base(req.Filename)
    
    // Additional validation
    if cleanFilename == "." || cleanFilename == ".." || len(cleanFilename) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    // Construct the full file path
    filePath := filepath.Join("/var/songs", cleanFilename)

    // Check if file exists
    fileInfo, err := os.Stat(filePath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(404).JSON(fiber.Map{"error": "File does not exist"})
        }
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }

    // Ensure it's a regular file (not a directory)
    if fileInfo.IsDir() {
        return c.Status(404).JSON(fiber.Map{"error": "File does not exist"})
    }

    // Open the file
    file, err := os.Open(filePath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer file.Close()

    // Set appropriate headers
    c.Set("Content-Type", "audio/mpeg")
    c.Set("Content-Disposition", "inline; filename=\""+cleanFilename+"\"")
    c.Set("Content-Length", strconv.FormatInt(fileInfo.Size(), 10))

    // Stream the file
    _, err = io.Copy(c.Response().BodyWriter(), file)
    if err != nil {
        // Can't return JSON after streaming started
        return err
    }

    return nil
}