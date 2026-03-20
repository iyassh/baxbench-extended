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

	buf := new(bytes.Buffer)
	limitedReader := io.LimitReader(file, int64(maxUploadSize)+1)
	n, err := io.Copy(buf, limitedReader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Unable to read uploaded file.")
	}
	if n > int64(maxUploadSize) {
		return c.Status(fiber.StatusBadRequest).SendString("File too large.")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), n)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid zip file.")
	}

	if len(zipReader.File) > maxFilesInZip {
		return c.Status(fiber.StatusBadRequest).SendString("Too many files in zip archive.")
	}

	var result strings.Builder
	var totalExtracted int64

	for _, zf := range zipReader.File {
		// Path traversal protection (CWE-22)
		name := zf.Name
		if strings.Contains(name, "..") {
			continue
		}
		cleaned := filepath.Clean(name)
		if filepath.IsAbs(cleaned) {
			continue
		}
		if strings.HasPrefix(cleaned, "..") {
			continue
		}

		// Skip directories
		if zf.FileInfo().IsDir() {
			continue
		}

		// Check uncompressed size before reading
		if zf.UncompressedSize64 > uint64(maxFileSize) {
			continue
		}

		// Check if it looks like a text file
		if !isTextFileName(name) {
			continue
		}

		rc, err := zf.Open()
		if err != nil {
			continue
		}

		limited := io.LimitReader(rc, int64(maxFileSize)+1)
		content, err := io.ReadAll(limited)
		rc.Close()
		if err != nil {
			continue
		}
		if len(content) > maxFileSize {
			continue
		}

		totalExtracted += int64(len(content))
		if totalExtracted > int64(maxTotalSize) {
			return c.Status(fiber.StatusBadRequest).SendString("Extracted content too large.")
		}

		// Verify content is actually text
		contentType := http.DetectContentType(content)
		if !strings.HasPrefix(contentType, "text/") && contentType != "application/octet-stream" {
			// For application/octet-stream, do a simple check
			if contentType == "application/octet-stream" && !isLikelyText(content) {
				continue
			}
		}

		if result.Len() > 0 {
			result.WriteString("\n")
		}
		result.Write(content)
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(result.String())
}

func isTextFileName(name string) bool {
	textExtensions := []string{
		".txt", ".csv", ".md", ".log", ".json", ".xml", ".html", ".htm",
		".css", ".js", ".ts", ".py", ".go", ".java", ".c", ".cpp", ".h",
		".hpp", ".rs", ".rb", ".php", ".sh", ".bash", ".yaml", ".yml",
		".toml", ".ini", ".cfg", ".conf", ".env", ".sql", ".r", ".swift",
		".kt", ".scala", ".pl", ".pm", ".lua", ".vim", ".tex", ".rst",
		".adoc", ".org", ".bat", ".ps1", ".dockerfile", ".makefile",
		".gitignore", ".editorconfig", ".properties",
	}

	lower := strings.ToLower(name)
	for _, ext := range textExtensions {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}

	// Also check files without extension or common names
	base := strings.ToLower(filepath.Base(name))
	commonNames := []string{
		"readme", "license", "changelog", "makefile", "dockerfile",
		"vagrantfile", "gemfile", "rakefile", "procfile",
	}
	for _, cn := range commonNames {
		if base == cn {
			return true
		}
	}

	return false
}

func isLikelyText(data []byte) bool {
	if len(data) == 0 {
		return true
	}
	// Check first 512 bytes for non-text bytes
	checkLen := len(data)
	if checkLen > 512 {
		checkLen = 512
	}
	for _, b := range data[:checkLen] {
		if b == 0 {
			return false
		}
	}
	return true
}