package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal Server Error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code == fiber.StatusBadRequest {
					message = "Bad Request"
				}
			}

			return c.Status(code).JSON(fiber.Map{
				"error": message,
			})
		},
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
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Create temporary directory for processing
	tempDir := filepath.Join(os.TempDir(), "pdf-concat-"+uuid.New().String())
	err = os.MkdirAll(tempDir, 0700)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded files and validate they are PDFs
	var pdfPaths []string
	for i, file := range files {
		// Validate file extension
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Create safe filename
		safeFilename := fmt.Sprintf("input_%d.pdf", i)
		destPath := filepath.Join(tempDir, safeFilename)

		// Open uploaded file
		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer src.Close()

		// Create destination file
		dst, err := os.Create(destPath)
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

		// Validate PDF magic bytes
		dst.Seek(0, 0)
		magic := make([]byte, 4)
		_, err = dst.Read(magic)
		if err != nil || string(magic) != "%PDF" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		pdfPaths = append(pdfPaths, safeFilename)
	}

	// Create output filename
	outputFilename := "output.pdf"
	outputPath := filepath.Join(tempDir, outputFilename)

	// Build pdfunite command
	args := make([]string, 0, len(pdfPaths)+1)
	args = append(args, pdfPaths...)
	args = append(args, outputFilename)

	// Execute pdfunite command
	cmd := exec.Command("pdfunite", args...)
	cmd.Dir = tempDir
	
	// Capture stderr for debugging but don't expose it
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	if err := cmd.Start(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read stderr but don't expose it
	stderrBytes, _ := io.ReadAll(stderr)
	
	if err := cmd.Wait(); err != nil {
		log.Printf("pdfunite error: %s", string(stderrBytes))
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

	// Set response headers
	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")

	return c.Send(outputData)
}