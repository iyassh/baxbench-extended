package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	maxFileSize = 10 * 1024 * 1024 // 10MB max file size
	tempDir     = "/tmp/pdf-converter"
	timeout     = 30 * time.Second
)

func main() {
	// Create temp directory if it doesn't exist
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		log.Fatal("Failed to create temp directory:", err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit:             maxFileSize,
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/convert", handleConvert)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
	// Parse multipart form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File upload failed",
		})
	}

	// Validate file extension
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file format",
		})
	}

	// Validate file size
	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Generate unique filename
	uniqueID := uuid.New().String()
	inputPath := filepath.Join(tempDir, fmt.Sprintf("%s.pdf", uniqueID))
	outputPath := filepath.Join(tempDir, fmt.Sprintf("%s.txt", uniqueID))

	// Clean up files after processing
	defer func() {
		os.Remove(inputPath)
		os.Remove(outputPath)
	}()

	// Save uploaded file
	if err := c.SaveFile(file, inputPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	// Validate that the file is actually a PDF
	if !isValidPDF(inputPath) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid PDF file",
		})
	}

	// Execute pdftotext with timeout
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "pdftotext", "-layout", "-nopgbrk", inputPath, outputPath)
	cmd.Env = []string{"PATH=/usr/bin:/bin"} // Restrict PATH

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Processing timeout",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "PDF conversion failed",
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

func isValidPDF(filePath string) bool {
	file, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer file.Close()

	// Read first 5 bytes to check PDF magic number
	header := make([]byte, 5)
	_, err = io.ReadFull(file, header)
	if err != nil {
		return false
	}

	// Check for PDF magic number %PDF-
	return string(header) == "%PDF-"
}