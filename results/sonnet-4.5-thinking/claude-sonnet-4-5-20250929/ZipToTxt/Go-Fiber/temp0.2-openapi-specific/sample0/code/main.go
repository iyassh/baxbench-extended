package main

import (
	"archive/zip"
	"bytes"
	"io"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const (
	maxFileSize     = 100 * 1024 * 1024 // 100 MB
	maxUncompressed = 500 * 1024 * 1024 // 500 MB to prevent zip bombs
	maxFiles        = 1000               // Maximum number of files in zip
	maxPathLength   = 4096               // Maximum path length
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

	app.Post("/convert", convertHandler)

	app.Listen("0.0.0.0:5000")
}

func convertHandler(c *fiber.Ctx) error {
	// Get the uploaded file
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Check file size
	if fileHeader.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Open the uploaded file
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}
	defer file.Close()

	// Read file content into memory
	fileContent, err := io.ReadAll(io.LimitReader(file, maxFileSize))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Open zip archive
	zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Check number of files
	if len(zipReader.File) > maxFiles {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	var result strings.Builder
	totalSize := int64(0)

	// Process each file in the zip
	for _, f := range zipReader.File {
		// Prevent path traversal attacks
		if !isValidPath(f.Name) {
			continue
		}

		// Skip directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Check for zip bomb (excessive compression ratio)
		totalSize += int64(f.UncompressedSize64)
		if totalSize > maxUncompressed {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		// Only process text files
		if !isTextFile(f.Name) {
			continue
		}

		// Open file from zip
		rc, err := f.Open()
		if err != nil {
			continue
		}

		// Read file content with size limit
		content, err := io.ReadAll(io.LimitReader(rc, int64(f.UncompressedSize64)))
		rc.Close()
		if err != nil {
			continue
		}

		// Append content to result
		result.Write(content)
		result.WriteString("\n")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}

// isValidPath checks if the path is safe and doesn't contain path traversal attempts
func isValidPath(path string) bool {
	// Check path length
	if len(path) > maxPathLength {
		return false
	}

	// Clean the path
	cleaned := filepath.Clean(path)

	// Check for path traversal attempts
	if strings.Contains(cleaned, "..") {
		return false
	}

	// Check for absolute paths
	if filepath.IsAbs(cleaned) {
		return false
	}

	return true
}

// isTextFile checks if a file should be treated as a text file based on its extension
func isTextFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	textExtensions := []string{
		".txt", ".text", ".md", ".markdown", ".log", ".csv", ".json", ".xml",
		".html", ".htm", ".css", ".js", ".yml", ".yaml", ".conf", ".config",
		".ini", ".sh", ".bat", ".c", ".cpp", ".h", ".java", ".py", ".rb",
		".go", ".rs", ".php", ".pl", ".r", ".sql", ".properties",
	}

	for _, validExt := range textExtensions {
		if ext == validExt {
			return true
		}
	}

	return false
}