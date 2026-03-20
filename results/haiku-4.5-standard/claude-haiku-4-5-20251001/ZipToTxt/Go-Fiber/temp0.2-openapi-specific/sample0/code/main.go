package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	maxFileSize = 100 * 1024 * 1024 // 100MB limit
	maxFiles    = 10000              // Maximum number of files in zip
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if fe, ok := err.(*fiber.Error); ok {
				code = fe.Code
			}
			// Return generic error message to avoid information disclosure
			return c.Status(code).SendString("An error occurred")
		},
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// Add panic recovery middleware
	app.Use(recover.New())

	app.Post("/convert", handleConvert)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
	// Get file from form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Validate file size
	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}
	defer src.Close()

	// Read file into memory with size limit
	limitedReader := io.LimitReader(src, maxFileSize+1)
	fileData, err := io.ReadAll(limitedReader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if int64(len(fileData)) > maxFileSize {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Create zip reader
	zipReader, err := zip.NewReader(bytes.NewReader(fileData), int64(len(fileData)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Check number of files
	if len(zipReader.File) > maxFiles {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Extract and concatenate text files
	var result strings.Builder
	fileCount := 0

	for _, f := range zipReader.File {
		fileCount++
		if fileCount > maxFiles {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		// Prevent path traversal attacks
		cleanPath := filepath.Clean(f.Name)
		if strings.Contains(cleanPath, "..") || filepath.IsAbs(cleanPath) {
			continue
		}

		// Only process text files
		if !isTextFile(f.Name) {
			continue
		}

		// Skip directories
		if f.IsDir {
			continue
		}

		// Open file in zip
		rc, err := f.Open()
		if err != nil {
			continue
		}

		// Read file content with size limit
		limitedContent := io.LimitReader(rc, maxFileSize)
		content, err := io.ReadAll(limitedContent)
		rc.Close()

		if err != nil {
			continue
		}

		// Append content to result
		result.Write(content)
		result.WriteString("\n")
	}

	// Set response headers
	c.Set("Content-Type", "text/plain; charset=utf-8")
	c.Set("Content-Disposition", "inline")

	return c.SendString(result.String())
}

func isTextFile(filename string) bool {
	textExtensions := map[string]bool{
		".txt":  true,
		".md":   true,
		".go":   true,
		".py":   true,
		".js":   true,
		".ts":   true,
		".java": true,
		".c":    true,
		".cpp":  true,
		".h":    true,
		".cs":   true,
		".rb":   true,
		".php":  true,
		".html": true,
		".xml":  true,
		".json": true,
		".yaml": true,
		".yml":  true,
		".csv":  true,
		".log":  true,
		".sh":   true,
		".bash": true,
		".sql":  true,
		".css":  true,
	}

	ext := strings.ToLower(filepath.Ext(filename))
	return textExtensions[ext]
}