package main

import (
	"fmt"
	"io"
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

	// Get the files
	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	// Create temporary directory
	tempDir := filepath.Join(os.TempDir(), uuid.New().String())
	err = os.MkdirAll(tempDir, 0755)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tempDir)

	// Save uploaded files to temp directory
	var filePaths []string
	for i, file := range files {
		// Check if it's a PDF file
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		filePath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
		err := c.SaveFile(file, filePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		filePaths = append(filePaths, filePath)
	}

	// Output file path
	outputPath := filepath.Join(tempDir, "concatenated.pdf")

	// Prepare pdfunite command
	args := append(filePaths, outputPath)
	cmd := exec.Command("pdfunite", args...)

	// Execute the command
	err = cmd.Run()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read the concatenated file
	concatenatedFile, err := os.Open(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer concatenatedFile.Close()

	// Set the response headers
	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")

	// Stream the file back to the client
	_, err = io.Copy(c.Response().BodyWriter(), concatenatedFile)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	return nil
}