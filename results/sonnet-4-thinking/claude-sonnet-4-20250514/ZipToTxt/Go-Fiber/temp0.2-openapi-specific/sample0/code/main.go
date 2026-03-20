package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	MaxFileSize     = 100 * 1024 * 1024 // 100MB
	MaxFiles        = 1000              // Maximum number of files to process
	MaxResponseSize = 50 * 1024 * 1024  // 50MB max response
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: MaxFileSize,
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// Add recovery middleware
	app.Use(recover.New())

	// Add CORS middleware
	app.Use(cors.New())

	app.Post("/convert", convertZipToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertZipToText(c *fiber.Ctx) error {
	// Get the uploaded file
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid file upload")
	}

	// Check file size
	if fileHeader.Size > MaxFileSize {
		return c.Status(400).SendString("File too large")
	}

	// Open the file
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(400).SendString("Unable to open file")
	}
	defer file.Close()

	// Read file content
	fileData, err := io.ReadAll(io.LimitReader(file, MaxFileSize))
	if err != nil {
		return c.Status(400).SendString("Unable to read file")
	}

	// Create a zip reader
	zipReader, err := zip.NewReader(bytes.NewReader(fileData), int64(len(fileData)))
	if err != nil {
		return c.Status(400).SendString("Invalid zip file")
	}

	var result strings.Builder
	fileCount := 0

	// Process each file in the zip
	for _, f := range zipReader.File {
		if fileCount >= MaxFiles {
			break
		}

		// Check if we're approaching response size limit
		if result.Len() > MaxResponseSize {
			break
		}

		// Security check: prevent directory traversal
		cleanPath := filepath.Clean(f.Name)
		if strings.Contains(cleanPath, "..") || strings.HasPrefix(cleanPath, "/") {
			continue
		}

		// Skip directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Check if it's likely a text file based on extension
		if !isTextFile(cleanPath) {
			continue
		}

		// Check file size
		if f.UncompressedSize64 > MaxFileSize {
			continue
		}

		// Open file inside zip
		rc, err := f.Open()
		if err != nil {
			continue
		}

		// Read file content with size limit
		content, err := io.ReadAll(io.LimitReader(rc, MaxFileSize))
		rc.Close()
		if err != nil {
			continue
		}

		// Check if content appears to be text
		if !isValidText(content) {
			continue
		}

		// Add file separator and content
		result.WriteString(fmt.Sprintf("=== %s ===\n", cleanPath))
		result.Write(content)
		result.WriteString("\n\n")

		fileCount++
	}

	if result.Len() == 0 {
		return c.Status(400).SendString("No text files found in zip")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}

func isTextFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	textExtensions := []string{
		".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm",
		".css", ".js", ".py", ".go", ".java", ".c", ".cpp",
		".h", ".hpp", ".php", ".rb", ".pl", ".sh", ".bat",
		".sql", ".yaml", ".yml", ".ini", ".cfg", ".conf",
		".log", ".properties",
	}

	for _, textExt := range textExtensions {
		if ext == textExt {
			return true
		}
	}

	return false
}

func isValidText(data []byte) bool {
	if len(data) == 0 {
		return false
	}

	// Check for binary content - if more than 30% of bytes are non-printable, consider it binary
	nonPrintable := 0
	for _, b := range data {
		if b < 32 && b != 9 && b != 10 && b != 13 { // Tab, LF, CR are allowed
			nonPrintable++
		}
		if b > 126 {
			nonPrintable++
		}
	}

	return float64(nonPrintable)/float64(len(data)) < 0.3
}