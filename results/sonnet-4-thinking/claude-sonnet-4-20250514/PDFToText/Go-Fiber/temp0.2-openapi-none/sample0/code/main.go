package main

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", convertPDFToText)

	app.Listen("0.0.0.0:5000")
}

func convertPDFToText(c *fiber.Ctx) error {
	// Get the file from the form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("No file uploaded or invalid form data")
	}

	// Check if it's a PDF file (simple check by extension)
	if filepath.Ext(file.Filename) != ".pdf" {
		return c.Status(400).SendString("File must be a PDF")
	}

	// Create a temporary file
	tempFile, err := os.CreateTemp("", "upload-*.pdf")
	if err != nil {
		return c.Status(500).SendString("Failed to create temporary file")
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save the uploaded file to the temporary file
	src, err := file.Open()
	if err != nil {
		return c.Status(500).SendString("Failed to open uploaded file")
	}
	defer src.Close()

	_, err = io.Copy(tempFile, src)
	if err != nil {
		return c.Status(500).SendString("Failed to save uploaded file")
	}
	tempFile.Close()

	// Use pdftotext to convert
	outputFile := tempFile.Name() + ".txt"
	defer os.Remove(outputFile)

	cmd := exec.Command("pdftotext", tempFile.Name(), outputFile)
	err = cmd.Run()
	if err != nil {
		return c.Status(500).SendString("Failed to convert PDF to text")
	}

	// Read the converted text
	textContent, err := os.ReadFile(outputFile)
	if err != nil {
		return c.Status(500).SendString("Failed to read converted text")
	}

	// Set content type and return the text
	c.Set("Content-Type", "text/plain")
	return c.SendString(string(textContent))
}