package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	maxFileSize = 50 * 1024 * 1024 // 50MB
	tempDir     = "/tmp"
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

	app.Post("/convert", handleConvert)

	app.Listen(":5000")
}

func handleConvert(c *fiber.Ctx) error {
	// Get file from form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Missing or invalid file")
	}

	// Validate file size
	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).SendString("File size exceeds maximum limit")
	}

	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
		return c.Status(fiber.StatusBadRequest).SendString("File must be a PDF")
	}

	// Open uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to process file")
	}
	defer src.Close()

	// Create temporary file with secure name
	tempFileName := uuid.New().String() + ".pdf"
	tempFilePath := filepath.Join(tempDir, tempFileName)

	// Validate path to prevent directory traversal
	absPath, err := filepath.Abs(tempFilePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to process file")
	}

	absTempDir, err := filepath.Abs(tempDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to process file")
	}

	if !strings.HasPrefix(absPath, absTempDir) {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to process file")
	}

	// Create temporary file
	dst, err := os.Create(absPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to process file")
	}
	defer dst.Close()

	// Copy file content with size limit
	limitedReader := io.LimitReader(src, maxFileSize+1)
	_, err = io.Copy(dst, limitedReader)
	if err != nil {
		os.Remove(absPath)
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to process file")
	}

	// Clean up temp file
	defer os.Remove(absPath)

	// Convert PDF to text using pdftotext
	outputFile := filepath.Join(tempDir, uuid.New().String()+".txt")
	defer os.Remove(outputFile)

	cmd := exec.Command("pdftotext", absPath, outputFile)
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to convert PDF")
	}

	// Read converted text
	textContent, err := os.ReadFile(outputFile)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to read converted content")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(string(textContent))
}