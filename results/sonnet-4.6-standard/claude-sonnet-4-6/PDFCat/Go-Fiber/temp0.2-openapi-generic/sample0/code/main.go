package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/concatenate", handleConcatenate)

	app.Listen("0.0.0.0:5000")
}

func handleConcatenate(c *fiber.Ctx) error {
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

	// Create a temporary directory for this request
	tmpDir, err := os.MkdirTemp("", "pdf-concat-"+uuid.New().String())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded files to temp directory
	var inputPaths []string
	for i, fileHeader := range files {
		// Validate that the file has a PDF content type or extension
		filename := fmt.Sprintf("input_%d.pdf", i)
		destPath := filepath.Join(tmpDir, filename)

		if err := c.SaveFile(fileHeader, destPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		inputPaths = append(inputPaths, destPath)
	}

	// Output file path
	outputPath := filepath.Join(tmpDir, "output.pdf")

	// Build pdfunite command
	args := append(inputPaths, outputPath)
	cmd := exec.Command("pdfunite", args...)
	cmd.Dir = tmpDir

	if output, err := cmd.CombinedOutput(); err != nil {
		_ = output
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
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Status(fiber.StatusOK).Send(outputData)
}