package main

import (
    "encoding/json"
    "fmt"
    "io"
    "os"
    "path/filepath"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

type DownloadRequest struct {
    Filename string `json:"filename"`
}

func main() {
    app := fiber.New(fiber.Config{
        // Disable error handler to have full control over error messages
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            // Don't expose internal error details
            return ctx.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Internal server error",
            })
        },
    })

    // Add security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none';")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/download", handleDownload)

    app.Listen("0.0.0.0:5000")
}

func handleDownload(c *fiber.Ctx) error {
    var req DownloadRequest
    
    // Parse JSON request body
    if err := json.Unmarshal(c.Body(), &req); err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid JSON format",
        })
    }
    
    // Validate filename is not empty
    if req.Filename == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Filename is required",
        })
    }
    
    // Sanitize filename to prevent path traversal attacks
    // Remove any path separators and parent directory references
    cleanFilename := filepath.Base(req.Filename)
    
    // Additional checks for path traversal attempts
    if strings.Contains(req.Filename, "..") || strings.Contains(req.Filename, "/") || strings.Contains(req.Filename, "\\") {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid filename",
        })
    }
    
    // Ensure the filename is clean and matches what we expect
    if cleanFilename != req.Filename || cleanFilename == "." || cleanFilename == "/" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid filename format",
        })
    }
    
    // Construct the full file path
    songsDir := "/var/songs"
    filePath := filepath.Join(songsDir, cleanFilename)
    
    // Double-check that the resolved path is within the songs directory
    absPath, err := filepath.Abs(filePath)
    if err != nil {
        // Don't expose the error details
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }
    
    absSongsDir, err := filepath.Abs(songsDir)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }
    
    // Ensure the file is within the songs directory
    rel, err := filepath.Rel(absSongsDir, absPath)
    if err != nil || strings.HasPrefix(rel, "..") {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid filename",
        })
    }
    
    // Check if file exists
    fileInfo, err := os.Stat(filePath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
                "error": "File not found",
            })
        }
        // Don't expose internal error details
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }
    
    // Ensure it's a regular file, not a directory
    if !fileInfo.Mode().IsRegular() {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "File not found",
        })
    }
    
    // Open the file
    file, err := os.Open(filePath)
    if err != nil {
        // Don't expose the actual error
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal server error",
        })
    }
    defer file.Close()
    
    // Set appropriate headers for audio streaming
    c.Set("Content-Type", "audio/mpeg")
    c.Set("Content-Disposition", "inline; filename=\""+cleanFilename+"\"")
    c.Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))
    
    // Stream the file content
    if _, err := io.Copy(c.Response().BodyWriter(), file); err != nil {
        // The response has already started, can't change status code
        // Just return the error to stop processing
        return err
    }
    
    return nil
}