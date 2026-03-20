package main

import (
    "fmt"
    "io"
    "os"
    "os/exec"
    "path/filepath"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: 100 * 1024 * 1024, // 100 MB limit
    })

    app.Post("/concatenate", concatenatePDFs)

    app.Listen("0.0.0.0:5000")
}

func concatenatePDFs(c *fiber.Ctx) error {
    // Parse the multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }

    // Get files from the form
    files := form.File["files"]
    if files == nil || len(files) < 1 {
        return c.Status(400).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }

    // Create a temporary directory for processing
    tempDir := filepath.Join(os.TempDir(), "pdf-concat-"+uuid.New().String())
    err = os.MkdirAll(tempDir, 0755)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    defer os.RemoveAll(tempDir)

    // Save uploaded files and prepare for concatenation
    var pdfPaths []string
    for i, file := range files {
        // Check file size (limit to 50MB per file)
        if file.Size > 50*1024*1024 {
            return c.Status(400).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }

        // Open the uploaded file
        src, err := file.Open()
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        defer src.Close()

        // Read first few bytes to check if it's a PDF
        header := make([]byte, 5)
        n, err := src.Read(header)
        if err != nil || n < 5 {
            return c.Status(400).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }
        
        // Check PDF magic number
        if string(header) != "%PDF-" {
            return c.Status(400).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }
        
        // Reset file position
        _, err = src.Seek(0, 0)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }

        // Create temporary file with safe name
        tempPath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
        dst, err := os.Create(tempPath)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        defer dst.Close()

        // Copy file content
        _, err = io.Copy(dst, src)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }

        pdfPaths = append(pdfPaths, tempPath)
    }

    // If only one file, just return it as is
    if len(pdfPaths) == 1 {
        outputData, err := os.ReadFile(pdfPaths[0])
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        c.Set("Content-Type", "application/pdf")
        c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")
        return c.Status(200).Send(outputData)
    }

    // Generate output file path
    outputPath := filepath.Join(tempDir, "output.pdf")

    // Prepare pdfunite command arguments
    args := append(pdfPaths, outputPath)

    // Execute pdfunite command
    cmd := exec.Command("pdfunite", args...)
    output, err := cmd.CombinedOutput()
    if err != nil {
        fmt.Printf("pdfunite error: %s\n", string(output))
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }

    // Read the concatenated PDF
    outputData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }

    // Set appropriate headers and return the PDF
    c.Set("Content-Type", "application/pdf")
    c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")
    
    return c.Status(200).Send(outputData)
}