<CODE>
package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	maxFileSize      = 50 * 1024 * 1024  // 50MB max zip file size
	maxExtractedSize = 100 * 1024 * 1024 // 100MB max total extracted size
	maxFiles         = 1000               // Maximum number of files to process
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             maxFileSize,
		DisableStartupMessage: false,
		ErrorHandler:          customErrorHandler,
	})

	app.Use(recover.New())
	app.Use(securityHeaders)

	app.Post("/convert", handleConvert)

	app.Listen("0.0.0.0:5000")
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "An error occurred"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input"
		}
	}

	c.Status(code)
	return c.SendString(message)
}

func handleConvert(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	if fileHeader.Size > maxFileSize {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(io.LimitReader(file, maxFileSize))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	result, err := convertZipToText(fileBytes)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result)
}

func convertZipToText(data []byte) (string, error) {
	reader := bytes.NewReader(data)
	zipReader, err := zip.NewReader(reader, int64(len(data)))
	if err != nil {
		return "", fmt.Errorf("invalid zip file")
	}

	if len(zipReader.File) > maxFiles {
		return "", fmt.Errorf("too many files")
	}

	var result strings.Builder
	var totalSize int64

	for _, file := range zipReader.File {
		if file.FileInfo().IsDir() {
			continue
		}

		if !isValidPath(file.Name) {
			continue
		}

		if !isTextFile(file.Name) {
			continue
		}

		if file.UncompressedSize64 > maxExtractedSize {
			return "", fmt.Errorf("file too large")
		}

		totalSize += int64(file.UncompressedSize64)
		if totalSize > maxExtractedSize {
			return "", fmt.Errorf("total size too large")
		}

		rc, err := file.Open()
		if err != nil {
			continue
		}

		content, err := io.ReadAll(io.LimitReader(rc, int64(file.UncompressedSize64)))
		rc.Close()
		if err != nil {
			continue
		}

		if len(content) > 0 {
			result.Write(content)
			if !bytes.HasSuffix(content, []byte("\n")) {
				result.WriteString("\n")
			}
		}
	}

	return result.String(), nil
}

func isValidPath(path string) bool {
	cleanPath := filepath.Clean(path)
	if strings.Contains(cleanPath, "..") {
		return false
	}
	if filepath.IsAbs(cleanPath) {
		return false
	}
	if strings.HasPrefix(cleanPath, "/") || strings.HasPrefix(cleanPath, "\\") {
		return false
	}
	return true
}

func isTextFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	textExtensions := map[string]bool{
		".txt":  true,
		".md":   true,
		".log":  true,
		".csv":  true,
		".json": true,
		".xml":  true,
		".html": true,
		".htm":  true,
		".css":  true,
		".js":   true,
		".py":   true,
		".go":   true,
		".java": true,
		".c":    true,
		".cpp":  true,
		".h":    true,
		".sh":   true,
		".yml":  true,
		".yaml": true,
		".ini":  true,
		".conf": true,
		".cfg":  true,
	}
	return textExtensions[ext]
}
</CODE>