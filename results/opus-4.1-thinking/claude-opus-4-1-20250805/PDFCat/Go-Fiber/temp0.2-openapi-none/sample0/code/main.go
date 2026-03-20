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
    
    app.Post("/concatenate", concatenatePDFs)
    
    app.Listen("0.0.0.0:5000")
}

func concatenatePDFs(c *fiber.Ctx) error {
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }
    
    files := form.File["files"]
    if len(files) == 0 {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }
    
    tempDir := filepath.Join(os.TempDir(), uuid.New().String())
    err = os.MkdirAll(tempDir, 0755)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    defer os.RemoveAll(tempDir)
    
    var inputPaths []string
    for i, file := range files {
        tempPath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
        if err := c.SaveFile(file, tempPath); err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        inputPaths = append(inputPaths, tempPath)
    }
    
    outputPath := filepath.Join(tempDir, "output.pdf")
    
    args := append(inputPaths, outputPath)
    cmd := exec.Command("pdfunite", args...)
    
    if err := cmd.Run(); err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    
    return c.SendFile(outputPath)
}