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
    
    app.Post("/concatenate", handleConcatenate)
    
    app.Listen("0.0.0.0:5000")
}

func handleConcatenate(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }
    
    files := form.File["files"]
    if len(files) < 1 {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }
    
    // Create temp directory
    tempDir := filepath.Join(os.TempDir(), uuid.New().String())
    err = os.Mkdir(tempDir, 0755)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    defer os.RemoveAll(tempDir)
    
    // Save uploaded files
    var filePaths []string
    for i, file := range files {
        tempPath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
        
        err := c.SaveFile(file, tempPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        
        filePaths = append(filePaths, tempPath)
    }
    
    // Output file path
    outputPath := filepath.Join(tempDir, "output.pdf")
    
    // Build pdfunite command
    args := append(filePaths, outputPath)
    cmd := exec.Command("pdfunite", args...)
    
    err = cmd.Run()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    
    // Read output file
    outputData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    
    // Set headers and return PDF
    c.Set("Content-Type", "application/pdf")
    return c.Send(outputData)
}