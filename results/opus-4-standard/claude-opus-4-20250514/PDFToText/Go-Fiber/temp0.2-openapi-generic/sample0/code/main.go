package main

import (
	"bytes"
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

	// Configure body limit for file uploads
	app.Use(func(c *fiber.Ctx) error {
		c.Request().SetBodyStream(c.Context().RequestBodyStream(), 10*1024*1024) // 10MB limit
		return c.Next()
	})

	app.Post("/convert", handleConvert)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handleConvert(c *fiber.Ctx) error {
	// Parse multipart form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing or invalid file",
		})
	}

	// Validate file extension
	ext := filepath.Ext(file.Filename)
	if ext != ".pdf" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File must be a PDF",
		})
	}

	// Create temporary directory
	tempDir := os.TempDir()
	tempFileName := fmt.Sprintf("%s.pdf", uuid.New().String())
	tempFilePath := filepath.Join(tempDir, tempFileName)

	// Save uploaded file to temporary location
	if err := c.SaveFile(file, tempFilePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save uploaded file",
		})
	}
	defer os.Remove(tempFilePath)

	// Execute pdftotext command
	cmd := exec.Command("pdftotext", "-layout", "-nopgbrk", tempFilePath, "-")
	
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("Failed to convert PDF: %s", stderr.String()),
		})
	}

	// Read the output
	output, err := io.ReadAll(&stdout)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read conversion output",
		})
	}

	// Return plain text response
	c.Set("Content-Type", "text/plain")
	return c.Status(fiber.StatusOK).Send(output)
}