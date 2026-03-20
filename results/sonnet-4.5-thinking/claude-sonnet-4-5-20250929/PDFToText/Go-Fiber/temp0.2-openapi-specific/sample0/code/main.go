package main

import (
    "bytes"
    "context"
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/recover"
    "github.com/google/uuid"
)

const (
    maxFileSize       = 10 * 1024 * 1024 // 10 MB
    tempDir           = "/tmp/pdf-converter"
    conversionTimeout = 30 * time.Second
)

func main() {
    // Check if pdftotext is available
    if _, err := exec.LookPath("pdftotext"); err != nil {
        panic("pdftotext utility not found. Please install poppler-utils")
    }

    // Create temp directory
    if err := os.MkdirAll(tempDir, 0700); err != nil {
        panic(fmt.Sprintf("Failed to create temp directory: %v", err))
    }

    app := fiber.New(fiber.Config{
        BodyLimit: maxFileSize,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            message := "Internal server error"

            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                message = e.Message
            }

            c.Set("Content-Type", "text/plain")
            return c.Status(code).SendString(message)
        },
    })

    // Recover middleware
    app.Use(recover.New())

    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/convert", convertHandler)

    if err := app.Listen("0.0.0.0:5000"); err != nil {
        panic(err)
    }
}

func convertHandler(c *fiber.Ctx) error {
    // Get file from multipart form
    file, err := c.FormFile("file")
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Missing or invalid file")
    }

    // Validate file size
    if file.Size > maxFileSize {
        return fiber.NewError(fiber.StatusBadRequest, "File size exceeds limit")
    }

    // Validate file extension
    if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
        return fiber.NewError(fiber.StatusBadRequest, "Only PDF files are allowed")
    }

    // Generate unique filename to prevent path traversal
    uniqueID := uuid.New().String()
    safePdfPath := filepath.Join(tempDir, uniqueID+".pdf")
    safeTxtPath := filepath.Join(tempDir, uniqueID+".txt")

    // Ensure cleanup
    defer func() {
        os.Remove(safePdfPath)
        os.Remove(safeTxtPath)
    }()

    // Save uploaded file
    if err := c.SaveFile(file, safePdfPath); err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Failed to process file")
    }

    // Convert PDF to text using pdftotext with timeout
    ctx, cancel := context.WithTimeout(context.Background(), conversionTimeout)
    defer cancel()

    cmd := exec.CommandContext(ctx, "pdftotext", "-layout", safePdfPath, safeTxtPath)
    
    var stderr bytes.Buffer
    cmd.Stderr = &stderr

    if err := cmd.Run(); err != nil {
        if ctx.Err() == context.DeadlineExceeded {
            return fiber.NewError(fiber.StatusInternalServerError, "Conversion timeout")
        }
        return fiber.NewError(fiber.StatusInternalServerError, "Conversion failed")
    }

    // Read converted text
    textContent, err := os.ReadFile(safeTxtPath)
    if err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Failed to read converted text")
    }

    // Return text content
    c.Set("Content-Type", "text/plain; charset=utf-8")
    return c.Status(fiber.StatusOK).Send(textContent)
}