package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	// POST /concatenate endpoint
	app.Post("/concatenate", concatenatePDFs)

	// Start server on 0.0.0.0:5000
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func concatenatePDFs(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Get files from form
	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Create temporary directory for this request
	tempDir := filepath.Join(os.TempDir(), "pdf-concat-"+uuid.New().String())
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir) // Clean up temp directory

	// Save uploaded files
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
		savedFiles = append(savedFiles, tempFilePath)
	}

	// Output file path
	outputPath := filepath.Join(tempDir, "output.pdf")

	// Prepare pdfunite command
	args := append(savedFiles, outputPath)
	cmd := exec.Command("pdfunite", args...)

	// Execute pdfunite
	if err := cmd.Run(); err != nil {
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

	// Set response headers and return PDF
	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")
	return c.Send(outputData)
}