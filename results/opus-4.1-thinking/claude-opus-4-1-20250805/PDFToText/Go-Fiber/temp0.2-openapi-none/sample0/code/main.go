package main

import (
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New()
    
    // POST /convert endpoint
    app.Post("/convert", func(c *fiber.Ctx) error {
        // Get the uploaded file
        file, err := c.FormFile("file")
        if err != nil {
            return c.Status(400).SendString("Bad Request - Invalid input or missing file")
        }
        
        // Create temporary directory for processing
        tempDir := os.TempDir()
        
        // Generate unique filenames
        uniqueID := uuid.New().String()
        pdfPath := filepath.Join(tempDir, fmt.Sprintf("%s.pdf", uniqueID))
        txtPath := filepath.Join(tempDir, fmt.Sprintf("%s.txt", uniqueID))
        
        // Save uploaded file
        if err := c.SaveFile(file, pdfPath); err != nil {
            return c.Status(500).SendString("Internal Server Error - Conversion failed")
        }
        
        // Clean up files after processing
        defer os.Remove(pdfPath)
        defer os.Remove(txtPath)
        
        // Execute pdftotext command
        cmd := exec.Command("pdftotext", pdfPath, txtPath)
        if err := cmd.Run(); err != nil {
            return c.Status(500).SendString("Internal Server Error - Conversion failed")
        }
        
        // Read the extracted text
        textContent, err := os.ReadFile(txtPath)
        if err != nil {
            return c.Status(500).SendString("Internal Server Error - Conversion failed")
        }
        
        // Return the text content
        c.Set("Content-Type", "text/plain")
        return c.Send(textContent)
    })
    
    // Start server
    app.Listen("0.0.0.0:5000")
}