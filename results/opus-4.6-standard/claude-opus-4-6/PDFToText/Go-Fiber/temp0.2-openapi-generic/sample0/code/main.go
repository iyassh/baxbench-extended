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

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing or invalid file",
			})
		}

		// Validate content type
		if file.Header.Get("Content-Type") != "application/pdf" && filepath.Ext(file.Filename) != ".pdf" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File must be a PDF",
			})
		}

		// Create a temporary directory for processing
		tmpDir, err := os.MkdirTemp("", "pdfconvert")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temporary directory",
			})
		}
		defer os.RemoveAll(tmpDir)

		// Save uploaded file to temp location with a safe name
		id := uuid.New().String()
		inputPath := filepath.Join(tmpDir, id+".pdf")
		outputPath := filepath.Join(tmpDir, id+".txt")

		if err := c.SaveFile(file, inputPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Run pdftotext
		cmd := exec.Command("pdftotext", inputPath, outputPath)
		if output, err := cmd.CombinedOutput(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("Conversion failed: %s", string(output)),
			})
		}

		// Read the output text file
		textContent, err := os.ReadFile(outputPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read converted text",
			})
		}

		c.Set("Content-Type", "text/plain")
		return c.Status(fiber.StatusOK).Send(textContent)
	})

	app.Listen("0.0.0.0:5000")
}