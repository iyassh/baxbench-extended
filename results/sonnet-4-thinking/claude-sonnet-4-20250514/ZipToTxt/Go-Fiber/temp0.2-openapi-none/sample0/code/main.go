package main

import (
    "archive/zip"
    "bytes"
    "io"
    "path/filepath"
    "strings"

    "github.com/gofiber/fiber/v2"
)

func isTextFile(filename string) bool {
    ext := strings.ToLower(filepath.Ext(filename))
    textExtensions := map[string]bool{
        ".txt": true, ".md": true, ".csv": true, ".json": true,
        ".xml": true, ".html": true, ".css": true, ".js": true,
        ".go": true, ".py": true, ".java": true, ".c": true,
        ".cpp": true, ".h": true, ".hpp": true, ".php": true,
        ".rb": true, ".sh": true, ".sql": true, ".yaml": true,
        ".yml": true, ".ini": true, ".cfg": true, ".conf": true,
        ".log": true, ".properties": true,
    }
    return textExtensions[ext]
}

func main() {
    app := fiber.New()

    app.Post("/convert", func(c *fiber.Ctx) error {
        // Get the uploaded file
        file, err := c.FormFile("file")
        if err != nil {
            return c.Status(400).SendString("No file uploaded")
        }

        // Open the uploaded file
        src, err := file.Open()
        if err != nil {
            return c.Status(400).SendString("Failed to open uploaded file")
        }
        defer src.Close()

        // Read file content into buffer
        buf := new(bytes.Buffer)
        _, err = io.Copy(buf, src)
        if err != nil {
            return c.Status(400).SendString("Failed to read uploaded file")
        }

        // Create zip reader
        zipReader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
        if err != nil {
            return c.Status(400).SendString("Invalid zip file")
        }

        var textContent strings.Builder

        // Process each file in the zip
        for _, f := range zipReader.File {
            // Skip directories
            if f.FileInfo().IsDir() {
                continue
            }

            // Check if this is a text file
            if isTextFile(f.Name) {
                rc, err := f.Open()
                if err != nil {
                    continue // Skip files that can't be opened
                }

                content, err := io.ReadAll(rc)
                rc.Close()
                if err != nil {
                    continue // Skip files that can't be read
                }

                // Add filename as header
                textContent.WriteString("=== " + f.Name + " ===\n")
                textContent.Write(content)
                textContent.WriteString("\n\n")
            }
        }

        // Return the concatenated text content
        c.Set("Content-Type", "text/plain")
        return c.SendString(textContent.String())
    })

    app.Listen("0.0.0.0:5000")
}