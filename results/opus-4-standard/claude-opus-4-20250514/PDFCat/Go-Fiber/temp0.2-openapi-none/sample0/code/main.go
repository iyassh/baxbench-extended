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
		var pdfPaths []string
		for i, file := range files {
			// Validate file is PDF by checking content type
			if file.Header.Get("Content-Type") != "application/pdf" {
				// Also check by extension as fallback
				ext := filepath.Ext(file.Filename)
				if ext != ".pdf" {
					return c.Status(400).JSON(fiber.Map{
						"error": "Invalid input or missing files.",
					})
				}
			}

			// Save file to temp directory
			tempPath := filepath.Join(tempDir, fmt.Sprintf("input_%d.pdf", i))
			err := c.SaveFile(file, tempPath)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{
					"error": "An error occurred while processing the files.",
				})
			}
			pdfPaths = append(pdfPaths, tempPath)
		}

		// Output file path
		outputPath := filepath.Join(tempDir, "concatenated.pdf")

		// Build pdfunite command
		args := append(pdfPaths, outputPath)
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
		concatenatedPDF, err := os.Open(outputPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer concatenatedPDF.Close()

		// Get file info for content length
		fileInfo, err := concatenatedPDF.Stat()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		// Set response headers
		c.Set("Content-Type", "application/pdf")
		c.Set("Content-Disposition", "attachment; filename=concatenated.pdf")
		c.Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))

		// Stream the file to response
		_, err = io.Copy(c.Response().BodyWriter(), concatenatedPDF)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		return nil
	})

	app.Listen("0.0.0.0:5000")
}