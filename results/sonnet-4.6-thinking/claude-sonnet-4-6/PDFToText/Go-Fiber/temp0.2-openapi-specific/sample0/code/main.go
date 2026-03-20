package main

import (
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	maxFileSize = 50 * 1024 * 1024 // 50 MB
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/convert", convertPDF)

	app.Listen("0.0.0.0:5000")
}

func convertPDF(c *fiber.Ctx) error {
	// Get the uploaded file
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing or invalid file",
		})
	}

	// Check file size
	if fileHeader.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Create a secure temporary directory
	tmpDir, err := os.MkdirTemp("", "pdfconvert-*")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer os.RemoveAll(tmpDir)

	// Generate a unique filename to avoid path traversal
	uniqueID := uuid.New().String()
	inputPath := filepath.Join(tmpDir, uniqueID+".pdf")
	outputPath := filepath.Join(tmpDir, uniqueID+".txt")

	// Save the uploaded file
	if err := c.SaveFile(fileHeader, inputPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Use pdftotext with explicit arguments - no user input in command args
	// inputPath and outputPath are constructed from uuid, not user input
	cmd := exec.Command("pdftotext", inputPath, outputPath)
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Conversion failed",
		})
	}

	// Read the output text file
	textContent, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Return the text content
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Status(fiber.StatusOK).Send(textContent)
}