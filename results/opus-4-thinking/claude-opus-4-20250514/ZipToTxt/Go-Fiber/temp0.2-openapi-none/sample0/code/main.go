package main

import (
    "archive/zip"
    "bytes"
    "io"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

func main() {
    app := fiber.New()
    
    app.Post("/convert", func(c *fiber.Ctx) error {
        // Parse multipart form
        file, err := c.FormFile("file")
        if err != nil {
            return c.Status(400).SendString("Invalid input")
        }
        
        // Open uploaded file
        uploadedFile, err := file.Open()
        if err != nil {
            return c.Status(400).SendString("Invalid input")
        }
        defer uploadedFile.Close()
        
        // Read file content into buffer
        buf := new(bytes.Buffer)
        _, err = io.Copy(buf, uploadedFile)
        if err != nil {
            return c.Status(400).SendString("Invalid input")
        }
        
        // Create zip reader from buffer
        zipReader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
        if err != nil {
            return c.Status(400).SendString("Invalid input")
        }
        
        // Extract and concatenate text files
        var result strings.Builder
        for _, file := range zipReader.File {
            // Skip directories
            if file.FileInfo().IsDir() {
                continue
            }
            
            // Check if it's a text file by extension
            lowercaseName := strings.ToLower(file.Name)
            if strings.HasSuffix(lowercaseName, ".txt") || 
               strings.HasSuffix(lowercaseName, ".text") ||
               strings.HasSuffix(lowercaseName, ".md") ||
               strings.HasSuffix(lowercaseName, ".log") ||
               strings.HasSuffix(lowercaseName, ".csv") {
                
                // Open file inside zip
                fileReader, err := file.Open()
                if err != nil {
                    continue
                }
                
                // Read content
                content, err := io.ReadAll(fileReader)
                fileReader.Close()
                if err != nil {
                    continue
                }
                
                // Add to result
                if result.Len() > 0 {
                    result.WriteString("\n")
                }
                result.WriteString(string(content))
            }
        }
        
        // Return concatenated content
        return c.SendString(result.String())
    })
    
    app.Listen("0.0.0.0:5000")
}