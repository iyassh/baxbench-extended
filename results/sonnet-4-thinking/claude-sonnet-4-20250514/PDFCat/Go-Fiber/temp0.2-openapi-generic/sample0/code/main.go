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
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid input or missing files.",
		})
	}

	if len(files) < 2 {
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

	var filePaths []string

	// Save uploaded files
	for i, file := range files {
		// Validate file extension
		if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Create temporary file path
		filePath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
		filePaths = append(filePaths, filePath)

		// Save file
		err = c.SaveFile(file, filePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
	}

	// Output file path
	outputPath := filepath.Join(tempDir, "output.pdf")

	// Prepare pdfunite command
	args := append(filePaths, outputPath)
	cmd := exec.Command("pdfunite", args...)
	
	err = cmd.Run()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	// Read the output file
	outputFile, err := os.Open(outputPath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer outputFile.Close()

	// Set headers for PDF response
	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")

	// Stream the file
	_, err = io.Copy(c.Response().BodyWriter(), outputFile)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}

	return nil
}