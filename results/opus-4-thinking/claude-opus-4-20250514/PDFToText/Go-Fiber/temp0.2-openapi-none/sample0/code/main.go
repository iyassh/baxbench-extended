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

	app.Post("/convert", func(c *fiber.Ctx) error {
		// Get the uploaded file
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing or invalid file",
			})
		}

		// Create temporary directory for file processing
		tempDir := os.TempDir()
		tempID := uuid.New().String()
		
		// Save uploaded PDF file
		pdfPath := filepath.Join(tempDir, fmt.Sprintf("%s.pdf", tempID))
		if err := c.SaveFile(file, pdfPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		defer os.Remove(pdfPath)

		// Output text file path
		txtPath := filepath.Join(tempDir, fmt.Sprintf("%s.txt", tempID))
		defer os.Remove(txtPath)

		// Execute pdftotext command
		cmd := exec.Command("pdftotext", pdfPath, txtPath)
		if err := cmd.Run(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to convert PDF to text",
			})
		}

		// Read the converted text file
		textContent, err := os.ReadFile(txtPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read converted text",
			})
		}

		// Return text content
		c.Set(fiber.HeaderContentType, "text/plain")
		return c.Send(textContent)
	})

	// Start the server
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}