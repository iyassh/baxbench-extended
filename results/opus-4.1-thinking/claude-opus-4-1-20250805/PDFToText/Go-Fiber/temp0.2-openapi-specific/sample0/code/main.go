package main

import (
    "context"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    "time"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

const (
    maxFileSize = 10 * 1024 * 1024 // 10MB max file size
    cmdTimeout  = 30 * time.Second
)

var tempDir string

func init() {
    // Set up temp directory with absolute path
    var err error
    tempDir, err = filepath.Abs("/tmp/pdf-converter")
    if err != nil {
        log.Fatal("Failed to resolve temp directory path")
    }
}

func main() {
    // Create temp directory if it doesn't exist
    if err := os.MkdirAll(tempDir, 0755); err != nil {
        log.Fatal("Failed to create temp directory")
    }
    
    app := fiber.New(fiber.Config{
        BodyLimit:    maxFileSize,
        ErrorHandler: customErrorHandler,
    })
    
    // Add security middleware
    app.Use(securityHeaders)
    
    // Define the convert endpoint
    app.Post("/convert", convertPDFToText)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'none'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    message := "Internal Server Error"
    
    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
        if code == fiber.StatusBadRequest {
            message = "Bad Request"
        }
    }
    
    c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
    return c.Status(code).JSON(fiber.Map{
        "error": message,
    })
}

func convertPDFToText(c *fiber.Ctx) error {
    // Parse multipart form
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Missing or invalid file",
        })
    }
    
    // Check if file is empty
    if file.Size == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "File is empty",
        })
    }
    
    // Check file size
    if file.Size > maxFileSize {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "File too large",
        })
    }
    
    // Validate file extension
    if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid file type",
        })
    }
    
    // Generate unique filename to prevent conflicts
    uniqueID := uuid.New().String()
    pdfPath := filepath.Join(tempDir, uniqueID+".pdf")
    txtPath := filepath.Join(tempDir, uniqueID+".txt")
    
    // Ensure paths are within temp directory (double check for path traversal)
    absPath, err := filepath.Abs(pdfPath)
    if err != nil || !strings.HasPrefix(absPath, tempDir) {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process file",
        })
    }
    
    // Clean up files after processing
    defer func() {
        os.Remove(pdfPath)
        os.Remove(txtPath)
    }()
    
    // Save uploaded file
    if err := c.SaveFile(file, pdfPath); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process file",
        })
    }
    
    // Execute pdftotext command with timeout
    ctx, cancel := context.WithTimeout(context.Background(), cmdTimeout)
    defer cancel()
    
    cmd := exec.CommandContext(ctx, "pdftotext", pdfPath, txtPath)
    
    // Run the command
    if err := cmd.Run(); err != nil {
        // Check if it was a timeout
        if ctx.Err() == context.DeadlineExceeded {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Conversion timeout",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to convert PDF",
        })
    }
    
    // Read the converted text
    textContent, err := os.ReadFile(txtPath)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to read converted text",
        })
    }
    
    // Return as plain text
    c.Set(fiber.HeaderContentType, "text/plain; charset=utf-8")
    return c.Status(fiber.StatusOK).Send(textContent)
}