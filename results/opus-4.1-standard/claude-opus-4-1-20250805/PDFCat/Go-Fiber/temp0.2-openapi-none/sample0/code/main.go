package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/concatenate", func(c *fiber.Ctx) error {
		// Parse multipart form
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Get files from form
		files := form.File["files"]
		if len(files) == 0 {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Create temporary directory for processing
		tempDir := filepath.Join(os.TempDir(), uuid.New().String())
		err = os.MkdirAll(tempDir, 0755)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer os.RemoveAll(tempDir)

		// Save uploaded files to temp directory
		var savedFiles []string
		for i, file := range files {
			tempFile := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
			err := c.SaveFile(file, tempFile)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{
					"error": "An error occurred while processing the files.",
				})
			}
			savedFiles = append(savedFiles, tempFile)
		}

		// Output file path
		outputFile := filepath.Join(tempDir, "output.pdf")

		// Build pdfunite command
		args := append(savedFiles, outputFile)
		cmd := exec.Command("pdfunite", args...)
		
		// Execute pdfunite
		output, err := cmd.CombinedOutput()
		if err != nil {
			fmt.Printf("pdfunite error: %s\n", string(output))
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		// Read the concatenated PDF
		file, err := os.Open(outputFile)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer file.Close()

		data, err := io.ReadAll(file)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		// Return the concatenated PDF
		c.Set("Content-Type", "application/pdf")
		return c.Status(200).Send(data)
	})

	app.Listen("0.0.0.0:5000")
}