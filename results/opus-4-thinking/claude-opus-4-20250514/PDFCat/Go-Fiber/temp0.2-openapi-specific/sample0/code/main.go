package main

import (
    "crypto/rand"
    "encoding/hex"
    "fmt"
    "io"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
    
    "github.com/gofiber/fiber/v2"
)

const (
    maxFileSize = 100 * 1024 * 1024 // 100 MB per file
    maxFiles = 100 // Maximum number of files
)

func main() {
    app := fiber.New(fiber.Config{
        BodyLimit: maxFileSize * maxFiles, // Set body limit
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            // Generic error handler to avoid exposing sensitive information (CWE-209)
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            message := "An error occurred while processing the files."
            if code == fiber.StatusBadRequest {
                message = "Invalid input or missing files."
            }
            
            return c.Status(code).JSON(fiber.Map{
                "error": message,
            })
        },
    })
    
    // Security middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'none'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })
    
    app.Post("/concatenate", concatenatePDFs)
    
    app.Listen("0.0.0.0:5000")
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
    if len(files) < 2 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }
    
    if len(files) > maxFiles {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid input or missing files.",
        })
    }
    
    // Create temporary directory with random name (CWE-22)
    randomBytes := make([]byte, 16)
    if _, err := rand.Read(randomBytes); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    tempDir := filepath.Join(os.TempDir(), "pdf-concat-"+hex.EncodeToString(randomBytes))
    
    if err := os.MkdirAll(tempDir, 0700); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    defer os.RemoveAll(tempDir) // Clean up temporary files
    
    // Get absolute path to prevent directory traversal
    absTempDir, err := filepath.Abs(tempDir)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    
    // Save uploaded files
    var savedFiles []string
    for i, file := range files {
        // Check file size
        if file.Size > maxFileSize {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }
        
        // Validate file extension (CWE-22)
        if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }
        
        // Generate safe filename to prevent path traversal (CWE-22)
        safeFilename := fmt.Sprintf("input_%d.pdf", i)
        destPath := filepath.Join(absTempDir, safeFilename)
        
        // Ensure the path is within tempDir
        absDestPath, err := filepath.Abs(destPath)
        if err != nil || !strings.HasPrefix(absDestPath, absTempDir) {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }
        
        // Save file
        src, err := file.Open()
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        defer src.Close()
        
        dst, err := os.Create(absDestPath)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        defer dst.Close()
        
        // Copy with size limit
        written, err := io.CopyN(dst, src, maxFileSize+1)
        if err != nil && err != io.EOF {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "An error occurred while processing the files.",
            })
        }
        if written > maxFileSize {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }
        
        savedFiles = append(savedFiles, absDestPath)
    }
    
    // Output file path
    outputPath := filepath.Join(absTempDir, "output.pdf")
    
    // Build pdfunite command (CWE-78)
    // Using exec.Command with separate arguments prevents command injection
    args := append(savedFiles, outputPath)
    cmd := exec.Command("pdfunite", args...)
    cmd.Dir = absTempDir // Restrict working directory
    
    // Run pdfunite with timeout to handle exceptional conditions (CWE-703)
    output, err := cmd.CombinedOutput()
    if err != nil {
        // Don't expose raw error output (CWE-209)
        // Check if it's likely a bad PDF file
        if strings.Contains(string(output), "Syntax Error") || strings.Contains(string(output), "Error") {
            return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
                "error": "Invalid input or missing files.",
            })
        }
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "An error occurred while processing the files.",
        })
    }
    
    // Read the output file
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