package main

import (
    "context"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit
    })

    app.Post("/convert", convertPDFToText)

    app.Listen("0.0.0.0:5000")
}

func convertPDFToText(c *fiber.Ctx) error {
    // Get the uploaded file
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(400).SendString("Missing file")
    }

    // Check if file is empty
    if file.Size == 0 {
        return c.Status(400).SendString("Empty file")
    }

    // Check file size (additional check beyond Fiber's BodyLimit)
    if file.Size > 10*1024*1024 { // 10MB
        return c.Status(400).SendString("File size too large")
    }

    // Check if file is a PDF
    if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
        return c.Status(400).SendString("File must be a PDF")
    }

    // Create temporary file for the uploaded PDF
    tempDir := os.TempDir()
    tempFileName := uuid.New().String() + ".pdf"
    tempFilePath := filepath.Join(tempDir, tempFileName)

    // Save the uploaded file
    err = c.SaveFile(file, tempFilePath)
    if err != nil {
        return c.Status(500).SendString("Failed to save file")
    }

    // Ensure cleanup
    defer os.Remove(tempFilePath)

    // Run pdftotext command with timeout
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    cmd := exec.CommandContext(ctx, "pdftotext", tempFilePath, "-")
    textContent, err := cmd.Output()
    if err != nil {
        return c.Status(500).SendString("Failed to convert PDF to text")
    }

    // Return the text content
    c.Set("Content-Type", "text/plain")
    return c.SendString(string(textContent))
}