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
	app := fiber.New()

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
	tempDir, err := os.MkdirTemp("", "pdf-concat-")
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
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Save file to temp directory
		tempFilePath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
		if err := c.SaveFile(file, tempFilePath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		// Validate PDF by checking magic bytes
		if err := validatePDF(tempFilePath); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		savedFiles = append(savedFiles, tempFilePath)
	}

	// Generate output filename
	outputFile := filepath.Join(tempDir, fmt.Sprintf("output_%s.pdf", uuid.New().String()))

	// Build pdfunite command
	args := append(savedFiles, outputFile)
	cmd := exec.Command("pdfunite", args...)
	
	// Execute pdfunite
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read the concatenated PDF
	concatenatedPDF, err := os.ReadFile(outputFile)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Set response headers and return PDF
	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Status(fiber.StatusOK).Send(concatenatedPDF)
}

func validatePDF(filePath string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	// Read first 5 bytes to check PDF magic number
	header := make([]byte, 5)
	_, err = io.ReadFull(file, header)
	if err != nil {
		return err
	}

	// Check if file starts with %PDF-
	if string(header) != "%PDF-" {
		return fmt.Errorf("not a valid PDF file")
	}

	return nil
}