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
	tmpDir := filepath.Join(os.TempDir(), uuid.New().String())
	if err := os.MkdirAll(tmpDir, 0700); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred while processing the files.",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Save uploaded files to temp directory
	var inputPaths []string
	for i, fileHeader := range files {
		inputPath := filepath.Join(tmpDir, fmt.Sprintf("input_%d.pdf", i))
		if err := c.SaveFile(fileHeader, inputPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		inputPaths = append(inputPaths, inputPath)
	}

	// Output file path
	outputPath := filepath.Join(tmpDir, "concatenated.pdf")

	// Build pdfunite command
	args := append(inputPaths, outputPath)
	cmd := exec.Command("pdfunite", args...)
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

	c.Set("Content-Type", "application/pdf")
	c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")
	return c.Status(fiber.StatusOK).Send(outputData)
}