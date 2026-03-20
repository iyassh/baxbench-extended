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
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	maxFileSize     = 100 * 1024 * 1024 // 100MB max file size
	maxExtractSize  = 500 * 1024 * 1024 // 500MB max extracted size
	maxFileCount    = 1000               // Maximum number of files in zip
	maxFileNameLen  = 255                // Maximum file name length
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		BodyLimit:    maxFileSize,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Add security headers
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

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusBadRequest {
			message = "Invalid input"
		}
	}

	return c.Status(code).SendString(message)
}

func handleConvert(c *fiber.Ctx) error {
	// Get the uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Validate file size
	if file.Size > maxFileSize {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}
	defer src.Close()

	// Read file into memory
	fileBytes := make([]byte, file.Size)
	_, err = io.ReadFull(src, fileBytes)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Process the zip file
	result, err := processZipFile(fileBytes)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Return the concatenated text
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(result)
}

func processZipFile(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}

	var result strings.Builder
	var totalExtractedSize int64
	fileCount := 0

	for _, file := range reader.File {
		fileCount++
		if fileCount > maxFileCount {
			return "", fmt.Errorf("too many files")
		}

		// Validate file name length
		if len(file.Name) > maxFileNameLen {
			return "", fmt.Errorf("file name too long")
		}

		// Prevent path traversal
		cleanPath := filepath.Clean(file.Name)
		if strings.Contains(cleanPath, "..") || filepath.IsAbs(cleanPath) {
			return "", fmt.Errorf("invalid file path")
		}

		// Skip directories
		if file.FileInfo().IsDir() {
			continue
		}

		// Check if it's a text file (by extension)
		if !isTextFile(file.Name) {
			continue
		}

		// Check uncompressed size to prevent zip bombs
		if file.UncompressedSize64 > maxExtractSize {
			return "", fmt.Errorf("file too large")
		}

		totalExtractedSize += int64(file.UncompressedSize64)
		if totalExtractedSize > maxExtractSize {
			return "", fmt.Errorf("extracted content too large")
		}

		// Open the file in the zip
		rc, err := file.Open()
		if err != nil {
			return "", err
		}

		// Read with size limit
		limitedReader := io.LimitReader(rc, maxExtractSize)
		content, err := io.ReadAll(limitedReader)
		rc.Close()
		if err != nil {
			return "", err
		}

		// Append to result
		if result.Len() > 0 {
			result.WriteString("\n")
		}
		result.Write(content)
	}

	return result.String(), nil
}

func isTextFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	textExtensions := map[string]bool{
		".txt":  true,
		".text": true,
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
		".hpp":  true,
		".sh":   true,
		".bat":  true,
		".yaml": true,
		".yml":  true,
		".ini":  true,
		".cfg":  true,
		".conf": true,
		".sql":  true,
	}
	return textExtensions[ext]
}