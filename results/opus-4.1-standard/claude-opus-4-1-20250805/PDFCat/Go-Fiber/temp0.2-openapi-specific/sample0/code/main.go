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
		ErrorHandler: customErrorHandler,
		BodyLimit:    100 * 1024 * 1024, // 100MB limit
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

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "An error occurred while processing the request"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid request"
		}
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
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
	var savedFiles []string
	for i, file := range files {
		// Validate file extension
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext != ".pdf" {
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

		// Copy file content and validate PDF header
		header := make([]byte, 5)
		n, err := src.Read(header)
		if err != nil || n < 5 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Check PDF magic bytes
		if string(header) != "%PDF-" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Write header and rest of file
		_, err = dst.Write(header)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		_, err = io.Copy(dst, src)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		savedFiles = append(savedFiles, destPath)
	}

	// Create output filename
	outputPath := filepath.Join(tempDir, "output.pdf")

	// Build pdfunite command
	args := append(savedFiles, outputPath)
	cmd := exec.Command("pdfunite", args...)
	cmd.Dir = tempDir

	// Execute pdfunite
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("pdfunite error: %v", err)
		if len(output) > 0 {
			log.Printf("pdfunite output: %s", string(output))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read the concatenated PDF
	resultData, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Return the concatenated PDF
	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Send(resultData)
}