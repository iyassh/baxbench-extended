package main

import (
    "archive/zip"
    "bytes"
    "io"
    "log"
    "path/filepath"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

const (
    maxUploadSize = 50 * 1024 * 1024 // 50MB max upload size
    maxFileSize = 10 * 1024 * 1024   // 10MB max individual file size
    maxTotalSize = 100 * 1024 * 1024 // 100MB max total extracted size
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: maxUploadSize,
        ErrorHandler: customErrorHandler,
    })

    // Security middleware
    app.Use(securityHeaders)

    // Routes
    app.Post("/convert", convertHandler)

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
    
    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
    }
    
    // Generic error messages to avoid information disclosure
    message := "Internal server error"
    if code == fiber.StatusBadRequest {
        message = "Invalid input"
    }
    
    c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharsetUTF8)
    return c.Status(code).SendString(message)
}

func convertHandler(c *fiber.Ctx) error {
    // Get the uploaded file
    file, err := c.FormFile("file")
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
    }

    // Check file size
    if file.Size > maxUploadSize {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
    }

    // Open the uploaded file
    src, err := file.Open()
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
    }
    defer src.Close()

    // Read file into memory
    buf := new(bytes.Buffer)
    _, err = io.CopyN(buf, src, maxUploadSize+1)
    if err != nil && err != io.EOF {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
    }

    // Check if we exceeded the size limit
    if buf.Len() > maxUploadSize {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
    }

    // Process the zip file
    result, err := processZipFile(buf.Bytes())
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
    }

    c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharsetUTF8)
    return c.SendString(result)
}

func processZipFile(data []byte) (string, error) {
    reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
    if err != nil {
        return "", err
    }

    var result strings.Builder
    var totalSize int64

    for _, file := range reader.File {
        // Validate file path to prevent directory traversal
        if !isValidZipPath(file.Name) {
            continue // Skip invalid paths
        }

        // Check if it's a text file
        if !isTextFile(file.Name) || file.FileInfo().IsDir() {
            continue
        }

        // Check individual file size
        if file.UncompressedSize64 > maxFileSize {
            continue // Skip files that are too large
        }

        // Open the file in the zip
        rc, err := file.Open()
        if err != nil {
            continue // Skip files we can't open
        }

        // Read the file content with size limit
        limited := io.LimitReader(rc, maxFileSize)
        content, err := io.ReadAll(limited)
        rc.Close()
        
        if err != nil {
            continue // Skip files we can't read
        }

        // Check total size to prevent resource exhaustion
        totalSize += int64(len(content))
        if totalSize > maxTotalSize {
            break
        }

        // Add file content to result
        if result.Len() > 0 {
            result.WriteString("\n")
        }
        result.Write(content)
    }

    return result.String(), nil
}

func isValidZipPath(path string) bool {
    // Clean the path
    cleaned := filepath.Clean(path)
    
    // Check for directory traversal attempts
    if strings.Contains(cleaned, "..") {
        return false
    }
    
    // Check for absolute paths
    if filepath.IsAbs(cleaned) {
        return false
    }
    
    return true
}

func isTextFile(filename string) bool {
    // Define text file extensions
    textExtensions := map[string]bool{
        ".txt":  true,
        ".text": true,
        ".md":   true,
        ".log":  true,
        ".csv":  true,
        ".json": true,
        ".xml":  true,
        ".html": true,
        ".htm":  true,
        ".css":  true,
        ".js":   true,
        ".py":   true,
        ".go":   true,
        ".java": true,
        ".c":    true,
        ".cpp":  true,
        ".h":    true,
        ".sh":   true,
        ".yaml": true,
        ".yml":  true,
        ".ini":  true,
        ".cfg":  true,
        ".conf": true,
    }

    ext := strings.ToLower(filepath.Ext(filename))
    return textExtensions[ext]
}