package main

import (
    "io"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

const (
    maxFileSize = 10 * 1024 * 1024 // 10MB limit
    tempDir = "/tmp"
)

func main() {
    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ErrorHandler: customErrorHandler,
        BodyLimit: maxFileSize,
    })
    
    // Add security middleware
    app.Use(func(c *fiber.Ctx) error {
        // Security headers
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Referrer-Policy", "no-referrer")
        c.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return c.Next()
    })
    
    app.Post("/convert", convertPDFHandler)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
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

func convertPDFHandler(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    
    // Get file from form
    files := form.File["file"]
    if len(files) == 0 {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    
    file := files[0]
    
    // Check file size
    if file.Size > maxFileSize {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    
    // Check if file is PDF by header
    src, err := file.Open()
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    defer src.Close()
    
    // Read first few bytes to check PDF header
    header := make([]byte, 5)
    if _, err := src.Read(header); err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    
    if string(header) != "%PDF-" {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    
    // Reset file reader
    src.Seek(0, 0)
    
    // Create temp file with secure name
    tempFileName := uuid.New().String() + ".pdf"
    tempFilePath := filepath.Join(tempDir, tempFileName)
    
    // Ensure we're writing to temp directory only
    cleanPath := filepath.Clean(tempFilePath)
    if !strings.HasPrefix(cleanPath, tempDir) {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    
    // Create temp file
    dst, err := os.Create(cleanPath)
    if err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
    }
    defer func() {
        dst.Close()
        os.Remove(cleanPath)
    }()
    
    // Copy uploaded file to temp file
    _, err = io.Copy(dst, src)
    if err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
    }
    
    // Close file before processing
    dst.Close()
    
    // Create output file path
    outputFileName := uuid.New().String() + ".txt"
    outputFilePath := filepath.Join(tempDir, outputFileName)
    cleanOutputPath := filepath.Clean(outputFilePath)
    
    if !strings.HasPrefix(cleanOutputPath, tempDir) {
        return fiber.NewError(fiber.StatusBadRequest, "Bad Request")
    }
    
    // Execute pdftotext command safely
    cmd := exec.Command("pdftotext", "-layout", "-nopgbrk", cleanPath, cleanOutputPath)
    cmd.Env = []string{} // Clear environment variables
    
    // Run command with timeout
    err = cmd.Run()
    if err != nil {
        os.Remove(cleanOutputPath)
        return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
    }
    
    // Read the output text file
    textContent, err := os.ReadFile(cleanOutputPath)
    if err != nil {
        os.Remove(cleanOutputPath)
        return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
    }
    
    // Clean up output file
    os.Remove(cleanOutputPath)
    
    // Return text content
    c.Set(fiber.HeaderContentType, "text/plain")
    return c.Send(textContent)
}