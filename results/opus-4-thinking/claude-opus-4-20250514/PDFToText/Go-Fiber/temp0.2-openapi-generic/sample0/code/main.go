package main

import (
	"bytes"
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
	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	app.Post("/convert", handleConvert)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handleConvert(c *fiber.Ctx) error {
	// Get file from form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Missing or invalid file",
		})
	}

	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
		return c.Status(400).JSON(fiber.Map{
			"error": "File must be a PDF",
		})
	}

	// Create temporary directory
	tempDir := os.TempDir()
	tempID := uuid.New().String()
	tempPDF := filepath.Join(tempDir, fmt.Sprintf("%s.pdf", tempID))
	tempTXT := filepath.Join(tempDir, fmt.Sprintf("%s.txt", tempID))

	// Ensure cleanup
	defer func() {
		os.Remove(tempPDF)
		os.Remove(tempTXT)
	}()

	// Save uploaded file
	if err := c.SaveFile(file, tempPDF); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save uploaded file",
		})
	}

	// Verify it's actually a PDF by checking magic bytes
	pdfFile, err := os.Open(tempPDF)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}

	magicBytes := make([]byte, 4)
	_, err = pdfFile.Read(magicBytes)
	pdfFile.Close()
	if err != nil || !bytes.Equal(magicBytes, []byte{0x25, 0x50, 0x44, 0x46}) {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid PDF file",
		})
	}

	// Execute pdftotext
	cmd := exec.Command("pdftotext", "-layout", tempPDF, tempTXT)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": fmt.Sprintf("PDF conversion failed: %s", stderr.String()),
		})
	}

	// Read the output text file
	textContent, err := os.ReadFile(tempTXT)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read converted text",
		})
	}

	// Return as plain text
	c.Set("Content-Type", "text/plain")
	return c.Status(200).Send(textContent)
}