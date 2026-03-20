package main

import (
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const maxFileSize = 50 * 1024 * 1024 // 50 MB

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

	app.Post("/convert", convertPDFToText)

	app.Listen("0.0.0.0:5000")
}

func convertPDFToText(c *fiber.Ctx) error {
	// Get the uploaded file
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing or invalid file",
		})
	}

	// Validate file size
	if fileHeader.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Validate content type
	contentType := fileHeader.Header.Get("Content-Type")
	if contentType != "application/pdf" {
		// Also check by extension as a fallback
		ext := filepath.Ext(fileHeader.Filename)
		if ext != ".pdf" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file type. Only PDF files are accepted",
			})
		}
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

	// Verify the saved file is within the temp directory (path traversal prevention)
	cleanInput, err := filepath.Abs(inputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	cleanTmpDir, err := filepath.Abs(tmpDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	if len(cleanInput) <= len(cleanTmpDir) || cleanInput[:len(cleanTmpDir)] != cleanTmpDir {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file path",
		})
	}

	// Use pdftotext with explicit arguments - no shell involved, safe from CWE-78
	// Pass file paths directly as arguments, not through shell
	cmd := exec.Command("pdftotext", cleanInput, outputPath)
	cmd.Env = []string{} // Restrict environment variables

	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to convert PDF",
		})
	}

	// Read the output text file
	textContent, err := os.ReadFile(outputPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read converted text",
		})
	}

	// Return plain text response
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Status(fiber.StatusOK).Send(textContent)
}