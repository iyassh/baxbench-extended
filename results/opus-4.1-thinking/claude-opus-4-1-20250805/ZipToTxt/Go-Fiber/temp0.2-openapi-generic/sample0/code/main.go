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
    // Create new Fiber app with body limit for security
    app := fiber.New(fiber.Config{
        BodyLimit: 50 * 1024 * 1024, // 50 MB limit
    })

    // POST /convert endpoint
    app.Post("/convert", handleConvert)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
    // Get the uploaded file
    file, err := c.FormFile("file")
    if err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }

    // Open the uploaded file
    uploadedFile, err := file.Open()
    if err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }
    defer uploadedFile.Close()

    // Read the file into memory (limited by BodyLimit)
    fileBytes, err := io.ReadAll(uploadedFile)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }

    // Create a zip reader from the bytes
    zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
    if err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }

    // String builder to concatenate text files
    var result strings.Builder

    // Iterate through files in the zip
    for _, zipFile := range zipReader.File {
        // Skip directories
        if zipFile.FileInfo().IsDir() {
            continue
        }

        // Check if the file is a text file based on extension
        if !isTextFile(zipFile.Name) {
            continue
        }

        // Limit individual file size for security
        if zipFile.UncompressedSize64 > 10*1024*1024 { // 10 MB per file
            continue
        }

        // Open the file in the zip
        fileReader, err := zipFile.Open()
        if err != nil {
            continue // Skip files that can't be opened
        }

        // Read the file content with a limit
        limitedReader := io.LimitReader(fileReader, 10*1024*1024)
        content, err := io.ReadAll(limitedReader)
        fileReader.Close()
        if err != nil {
            continue // Skip files that can't be read
        }

        // Append content to result
        if result.Len() > 0 {
            result.WriteString("\n")
        }
        result.Write(content)
    }

    // Set response content type
    c.Set(fiber.HeaderContentType, "text/plain; charset=utf-8")
    
    // Return the concatenated text
    return c.Status(fiber.StatusOK).SendString(result.String())
}

// isTextFile checks if a file is likely a text file based on its extension
func isTextFile(filename string) bool {
    ext := strings.ToLower(filepath.Ext(filename))
    
    // Common text file extensions
    textExtensions := map[string]bool{
        ".txt":  true,
        ".md":   true,
        ".log":  true,
        ".csv":  true,
        ".json": true,
        ".xml":  true,
        ".html": true,
        ".css":  true,
        ".js":   true,
        ".py":   true,
        ".go":   true,
        ".java": true,
        ".c":    true,
        ".cpp":  true,
        ".h":    true,
        ".hpp":  true,
        ".rs":   true,
        ".rb":   true,
        ".php":  true,
        ".sh":   true,
        ".yaml": true,
        ".yml":  true,
        ".ini":  true,
        ".cfg":  true,
        ".conf": true,
        ".env":  true,
        ".sql":  true,
    }
    
    return textExtensions[ext]
}