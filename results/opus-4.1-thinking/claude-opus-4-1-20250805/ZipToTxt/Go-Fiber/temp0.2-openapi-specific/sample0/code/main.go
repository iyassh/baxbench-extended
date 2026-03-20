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

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit for resource protection
    })
    
    // Security middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })
    
    app.Post("/convert", handleConvert)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
    // Get the uploaded file
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    // Open the uploaded file
    src, err := file.Open()
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    defer src.Close()
    
    // Read file into memory with limit
    limitedReader := io.LimitReader(src, 10*1024*1024)
    data, err := io.ReadAll(limitedReader)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    // Process the zip file
    result, err := processZip(data)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    c.Set("Content-Type", "text/plain")
    return c.SendString(result)
}

func processZip(data []byte) (string, error) {
    r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
    if err != nil {
        return "", err
    }
    
    var result strings.Builder
    const maxFileSize = 5 * 1024 * 1024
    const maxTotalSize = 50 * 1024 * 1024
    var totalSize int64
    
    for _, f := range r.File {
        // Prevent path traversal
        cleanName := filepath.Clean(f.Name)
        if strings.Contains(cleanName, "..") || filepath.IsAbs(cleanName) || strings.HasPrefix(cleanName, "/") {
            continue
        }
        
        // Check if it's a text file
        if !isTextFile(f.Name) {
            continue
        }
        
        // Check file size to prevent resource exhaustion
        if f.UncompressedSize64 > maxFileSize {
            continue
        }
        
        rc, err := f.Open()
        if err != nil {
            continue
        }
        
        // Read with size limit
        limited := io.LimitReader(rc, maxFileSize)
        content, err := io.ReadAll(limited)
        rc.Close()
        
        if err != nil {
            continue
        }
        
        // Check total size limit
        totalSize += int64(len(content))
        if totalSize > maxTotalSize {
            break
        }
        
        result.Write(content)
        result.WriteString("\n")
    }
    
    return result.String(), nil
}

func isTextFile(name string) bool {
    ext := strings.ToLower(filepath.Ext(name))
    textExts := []string{
        ".txt", ".text", ".md", ".log", ".csv", ".json", ".xml",
        ".html", ".css", ".js", ".py", ".go", ".java", ".c",
        ".cpp", ".h", ".hpp", ".sh", ".yml", ".yaml", ".toml",
        ".ini", ".cfg", ".conf",
    }
    
    for _, te := range textExts {
        if ext == te {
            return true
        }
    }
    return false
}