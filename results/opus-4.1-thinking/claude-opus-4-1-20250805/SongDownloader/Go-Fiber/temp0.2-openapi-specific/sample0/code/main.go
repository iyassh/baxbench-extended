package main

import (
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
        DisableStartupMessage: true,
        // Custom error handler to avoid exposing sensitive information (CWE-209)
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            message := "Internal server error"
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            switch code {
            case fiber.StatusBadRequest:
                message = "Invalid input"
            case fiber.StatusNotFound:
                message = "File does not exist"
            }
            
            return c.Status(code).SendString(message)
        },
    })
    
    // Security headers middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        return c.Next()
    })
    
    app.Post("/download", downloadHandler)
    
    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}

func downloadHandler(c *fiber.Ctx) error {
    var req DownloadRequest
    
    // Parse JSON request body
    if err := c.BodyParser(&req); err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }
    
    // Validate filename is not empty
    if req.Filename == "" {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }
    
    // Prevent path traversal attacks (CWE-22)
    if strings.Contains(req.Filename, "..") || 
       strings.Contains(req.Filename, "/") || 
       strings.Contains(req.Filename, "\\") ||
       strings.Contains(req.Filename, "\x00") {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }
    
    // Clean the filename
    cleanFilename := filepath.Base(req.Filename)
    if cleanFilename == "." || cleanFilename == ".." {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }
    
    // Construct the full path
    songsDir := "/var/songs"
    fullPath := filepath.Join(songsDir, cleanFilename)
    
    // Verify the resolved path is within the songs directory
    absPath, err := filepath.Abs(fullPath)
    if err != nil {
        // Don't expose the actual error (CWE-209, CWE-703)
        return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
    }
    
    absSongsDir, err := filepath.Abs(songsDir)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
    }
    
    // Ensure the resolved path is within the songs directory
    if !strings.HasPrefix(absPath, absSongsDir + string(os.PathSeparator)) {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }
    
    // Check if file exists
    fileInfo, err := os.Stat(absPath)
    if err != nil {
        if os.IsNotExist(err) {
            return c.Status(fiber.StatusNotFound).SendString("File does not exist")
        }
        // Handle other errors (CWE-703)
        return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
    }
    
    // Ensure it's a regular file
    if !fileInfo.Mode().IsRegular() {
        return c.Status(fiber.StatusNotFound).SendString("File does not exist")
    }
    
    // Open the file for reading
    file, err := os.Open(absPath)
    if err != nil {
        // Handle file open errors (CWE-703)
        return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
    }
    defer file.Close()
    
    // Set appropriate headers for audio streaming
    c.Set("Content-Type", "audio/mpeg")
    
    // Stream the file content
    _, err = io.Copy(c.Response().BodyWriter(), file)
    if err != nil {
        // Error during streaming (CWE-703)
        // Headers are already sent, so we can't change status
        return nil
    }
    
    return nil
}