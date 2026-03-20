package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred while processing the request.",
			})
		},
		BodyLimit: 200 * 1024 * 1024, // 200MB total limit
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Use(recover.New())

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

	if len(files) < 2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Limit number of files to prevent resource exhaustion
	if len(files) > 50 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", "pdf_concat_*")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer func() {
		if removeErr := os.RemoveAll(tempDir); removeErr != nil {
			log.Printf("Failed to cleanup temporary directory: %v", removeErr)
		}
	}()

	// Save uploaded files
	var inputFiles []string
	for i, file := range files {
		// Validate file extension
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Validate file size (individual file limit)
		if file.Size > 100*1024*1024 { // 100MB per file limit
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		if file.Size == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Generate safe filename using index only
		filename := fmt.Sprintf("input_%d.pdf", i)
		filePath := filepath.Join(tempDir, filename)
		
		// Save file
		if err := c.SaveFile(file, filePath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		inputFiles = append(inputFiles, filePath)
	}

	// Generate output filename
	outputFile := filepath.Join(tempDir, "output.pdf")

	// Prepare pdfunite command
	args := make([]string, 0, len(inputFiles)+1)
	args = append(args, inputFiles...)
	args = append(args, outputFile)
	
	cmd := exec.Command("pdfunite", args...)
	cmd.Dir = tempDir // Set working directory for additional security

	// Execute command
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Check if output file exists and has content
	fileInfo, err := os.Stat(outputFile)
	if os.IsNotExist(err) || fileInfo.Size() == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Set headers for PDF download
	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")

	// Return the file
	return c.SendFile(outputFile)
}