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
		BodyLimit: 100 * 1024 * 1024, // 100MB limit
	})

	app.Post("/concatenate", concatenatePDFs)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func concatenatePDFs(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Get files from form
	files := form.File["files"]
	if len(files) < 1 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Create temporary directory for processing
	tempDir := filepath.Join(os.TempDir(), "pdf-concat-"+uuid.New().String())
	err = os.MkdirAll(tempDir, 0700)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded files and validate they are PDFs
	var savedFiles []string
	for i, file := range files {
		// Validate file extension
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Open uploaded file
		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer src.Close()

		// Read first few bytes to validate PDF magic number
		header := make([]byte, 5)
		_, err = src.Read(header)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		src.Seek(0, 0) // Reset to beginning

		// Check PDF magic number
		if string(header) != "%PDF-" {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Save file to temp directory with safe name
		tempFilePath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
		dst, err := os.Create(tempFilePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer dst.Close()

		_, err = io.Copy(dst, src)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		savedFiles = append(savedFiles, tempFilePath)
	}

	// Create output file path
	outputPath := filepath.Join(tempDir, "output.pdf")

	// Build pdfunite command
	args := append(savedFiles, outputPath)
	cmd := exec.Command("pdfunite", args...)
	
	// Execute pdfunite
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("pdfunite error: %v, output: %s", err, string(output))
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read the concatenated PDF
	concatenatedPDF, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Return the concatenated PDF
	c.Set("Content-Type", "application/pdf")
	return c.Send(concatenatedPDF)
}