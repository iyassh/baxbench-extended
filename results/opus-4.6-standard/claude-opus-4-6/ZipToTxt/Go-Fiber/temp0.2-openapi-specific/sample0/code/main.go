package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const (
	maxUploadSize    = 50 * 1024 * 1024  // 50 MB max upload
	maxFileSize      = 10 * 1024 * 1024  // 10 MB max per file in zip
	maxTotalSize     = 100 * 1024 * 1024 // 100 MB max total extracted
	maxFilesInZip    = 1000
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             maxUploadSize,
		DisableStartupMessage: false,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/convert", handleConvert)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Printf("Failed to start server: %v\n", err)
	}
}

func isTextFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	textExtensions := map[string]bool{
		".txt": true, ".csv": true, ".log": true, ".md": true,
		".json": true, ".xml": true, ".html": true, ".htm": true,
		".css": true, ".js": true, ".py": true, ".go": true,
		".java": true, ".c": true, ".h": true, ".cpp": true,
		".rs": true, ".rb": true, ".sh": true, ".bat": true,
		".yaml": true, ".yml": true, ".toml": true, ".ini": true,
		".cfg": true, ".conf": true, ".properties": true,
		".sql": true, ".ts": true, ".jsx": true, ".tsx": true,
		".swift": true, ".kt": true, ".scala": true, ".pl": true,
		".r": true, ".lua": true, ".php": true, ".env": true,
		".gitignore": true, ".dockerfile": true, ".makefile": true,
		"": true, // files without extension might be text
	}
	return textExtensions[ext]
}

func sanitizePath(name string) (string, error) {
	// Clean the path
	cleaned := filepath.Clean(name)
	// Convert to forward slashes for consistency
	cleaned = filepath.ToSlash(cleaned)

	// Reject absolute paths
	if filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("absolute path not allowed")
	}

	// Reject path traversal
	if strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "/../") || strings.HasSuffix(cleaned, "/..") {
		return "", fmt.Errorf("path traversal not allowed")
	}

	// Reject paths starting with /
	if strings.HasPrefix(cleaned, "/") {
		return "", fmt.Errorf("path starting with / not allowed")
	}

	return cleaned, nil
}

func isLikelyText(data []byte) bool {
	if len(data) == 0 {
		return true
	}
	// Check using http.DetectContentType
	contentType := http.DetectContentType(data)
	return strings.HasPrefix(contentType, "text/") ||
		strings.Contains(contentType, "json") ||
		strings.Contains(contentType, "xml") ||
		strings.Contains(contentType, "javascript")
}

func handleConvert(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Missing or invalid file upload.")
	}

	if fileHeader.Size > int64(maxUploadSize) {
		return c.Status(fiber.StatusBadRequest).SendString("File too large.")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Unable to read uploaded file.")
	}
	defer file.Close()

	// Read the file into memory with size limit
	limitedReader := io.LimitReader(file, int64(maxUploadSize)+1)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Unable to read uploaded file.")
	}
	if len(data) > maxUploadSize {
		return c.Status(fiber.StatusBadRequest).SendString("File too large.")
	}

	reader := bytes.NewReader(data)
	zipReader, err := zip.NewReader(reader, int64(len(data)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid zip file.")
	}

	if len(zipReader.File) > maxFilesInZip {
		return c.Status(fiber.StatusBadRequest).SendString("Too many files in zip archive.")
	}

	var result strings.Builder
	var totalExtracted int64
	fileCount := 0

	for _, zf := range zipReader.File {
		// Sanitize path to prevent path traversal (CWE-22)
		safeName, err := sanitizePath(zf.Name)
		if err != nil {
			continue // Skip files with suspicious paths
		}

		// Skip directories
		if zf.FileInfo().IsDir() {
			continue
		}

		// Check if it's likely a text file by extension
		if !isTextFile(safeName) {
			continue
		}

		// Check uncompressed size before reading
		if zf.UncompressedSize64 > uint64(maxFileSize) {
			continue
		}

		rc, err := zf.Open()
		if err != nil {
			continue
		}

		// Read with size limit to prevent zip bombs (CWE-400)
		limitedReader := io.LimitReader(rc, int64(maxFileSize)+1)
		content, err := io.ReadAll(limitedReader)
		rc.Close()
		if err != nil {
			continue
		}

		if len(content) > maxFileSize {
			continue // Skip files that exceed the limit
		}

		totalExtracted += int64(len(content))
		if totalExtracted > int64(maxTotalSize) {
			return c.Status(fiber.StatusBadRequest).SendString("Total extracted content too large.")
		}

		// Verify the content is actually text-like
		if !isLikelyText(content) {
			continue
		}

		if fileCount > 0 {
			result.WriteString("\n")
		}

		result.WriteString(fmt.Sprintf("--- %s ---\n", safeName))
		result.Write(content)
		result.WriteString("\n")
		fileCount++
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(result.String())
}