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
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing or invalid file",
			})
		}

		// Validate content type
		if file.Header.Get("Content-Type") != "application/pdf" &&
			filepath.Ext(file.Filename) != ".pdf" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File must be a PDF",
			})
		}

		// Create a temporary directory for processing
		tmpDir := os.TempDir()
		uniqueID := uuid.New().String()
		tmpPDF := filepath.Join(tmpDir, fmt.Sprintf("%s.pdf", uniqueID))
		tmpTxt := filepath.Join(tmpDir, fmt.Sprintf("%s.txt", uniqueID))

		// Save uploaded file
		if err := c.SaveFile(file, tmpPDF); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		defer os.Remove(tmpPDF)
		defer os.Remove(tmpTxt)

		// Run pdftotext
		cmd := exec.Command("pdftotext", tmpPDF, tmpTxt)
		if output, err := cmd.CombinedOutput(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("Conversion failed: %s", string(output)),
			})
		}

		// Read the converted text
		textContent, err := os.ReadFile(tmpTxt)
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