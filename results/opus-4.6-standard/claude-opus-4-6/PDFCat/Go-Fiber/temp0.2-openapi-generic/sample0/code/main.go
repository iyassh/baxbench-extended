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
	app := fiber.New(fiber.Config{
		BodyLimit: 100 * 1024 * 1024, // 100 MB limit
	})

	app.Post("/concatenate", func(c *fiber.Ctx) error {
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		files := form.File["files"]
		if len(files) < 2 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input or missing files.",
			})
		}

		// Create a temporary directory for this request
		tmpDir, err := os.MkdirTemp("", "pdfconcat-")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}
		defer os.RemoveAll(tmpDir)

		var inputPaths []string

		for i, file := range files {
			// Validate content type
			contentType := file.Header.Get("Content-Type")
			if contentType != "application/pdf" && contentType != "application/octet-stream" && contentType != "" {
				// Be lenient but still save the file
			}

			// Use a safe filename
			safeName := fmt.Sprintf("input_%d.pdf", i)
			savePath := filepath.Join(tmpDir, safeName)

			if err := c.SaveFile(file, savePath); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "An error occurred while processing the files.",
				})
			}

			inputPaths = append(inputPaths, savePath)
		}

		// Output file
		outputName := uuid.New().String() + ".pdf"
		outputPath := filepath.Join(tmpDir, outputName)

		// Build pdfunite command
		args := append(inputPaths, outputPath)
		cmd := exec.Command("pdfunite", args...)

		if output, err := cmd.CombinedOutput(); err != nil {
			_ = output
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "An error occurred while processing the files.",
			})
		}

		c.Set("Content-Type", "application/pdf")
		c.Set("Content-Disposition", "attachment; filename=\"concatenated.pdf\"")

		return c.SendFile(outputPath)
	})

	app.Listen("0.0.0.0:5000")
}