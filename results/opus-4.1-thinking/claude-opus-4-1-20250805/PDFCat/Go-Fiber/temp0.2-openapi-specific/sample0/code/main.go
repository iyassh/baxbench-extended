package main

import (
    "fmt"
    "io"
    "log"
    "os"
    "os/exec"
    "path/filepath"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
)

func main() {
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            message := "An error occurred while processing the files."

            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                if code == fiber.StatusBadRequest {
                    message = "Invalid input or missing files."
                }
            }

            return c.Status(code).JSON(fiber.Map{
                "error": message,
            })
        },
        BodyLimit: 100 * 1024 * 1024, // 100MB limit
    })

    // Security middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    app.Post("/concatenate", concatenatePDFs)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func concatenatePDFs(c *fiber.Ctx) error {
    // Parse multipart form
    form, err := c.MultipartForm()
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }

    files := form.File["files"]
    if len(files) < 1 || len(files) > 100 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }

    // Create temporary directory for this request
    tempDir := filepath.Join(os.TempDir(), "pdf-concat-"+uuid.New().String())
    err = os.MkdirAll(tempDir, 0700)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    defer os.RemoveAll(tempDir)

    // Save uploaded files to temp directory
    var pdfPaths []string
    for i, file := range files {
        // Open the uploaded file
        src, err := file.Open()
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        defer src.Close()

        // Create safe filename
        safeName := fmt.Sprintf("input_%d.pdf", i)
        tempPath := filepath.Join(tempDir, safeName)

        // Create destination file
        dst, err := os.Create(tempPath)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        defer dst.Close()

        // Copy file content
        _, err = io.Copy(dst, src)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }

        pdfPaths = append(pdfPaths, tempPath)
    }

    // Create output path
    outputPath := filepath.Join(tempDir, "output.pdf")

    // Build command arguments
    cmdArgs := append(pdfPaths, outputPath)

    // Execute pdfunite command
    cmd := exec.Command("pdfunite", cmdArgs...)
    cmd.Dir = tempDir
    
    // Execute command
    err = cmd.Run()
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }

    // Read the concatenated PDF
    outputData, err := os.ReadFile(outputPath)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }

    // Return the concatenated PDF
    c.Set("Content-Type", "application/pdf")
    return c.Send(outputData)
}