package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	maxFileSize     = 100 * 1024 * 1024 // 100MB max file size
	maxMemory       = 10 * 1024 * 1024  // 10MB max memory for multipart
	maxTextFileSize = 10 * 1024 * 1024  // 10MB max size per text file
)

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		BodyLimit:    maxFileSize,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
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

	c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharsetUTF8)
	return c.Status(code).SendString(message)
}

func handleConvert(c *fiber.Ctx) error {
	// Parse multipart form with size limit
	form, err := c.MultipartForm()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	files := form.File["file"]
	if len(files) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	file := files[0]
	if file.Size > maxFileSize {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Open uploaded file
	src, err := file.Open()
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}
	defer src.Close()

	// Read file into memory with size limit
	buf := make([]byte, file.Size)
	n, err := io.ReadFull(src, buf)
	if err != nil || int64(n) != file.Size {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	// Process zip file
	result, err := processZipFile(buf)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid input")
	}

	c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharsetUTF8)
	return c.SendString(result)
}

func processZipFile(data []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}

	var result strings.Builder
	totalSize := 0

	for _, file := range reader.File {
		// Validate file path to prevent directory traversal
		cleanPath := filepath.Clean(file.Name)
		if strings.Contains(cleanPath, "..") || filepath.IsAbs(cleanPath) {
			continue
		}

		// Check if it's a text file
		if !isTextFile(file.Name) {
			continue
		}

		// Check file size to prevent resource exhaustion
		if file.UncompressedSize64 > maxTextFileSize {
			continue
		}

		// Open file in zip
		rc, err := file.Open()
		if err != nil {
			continue
		}

		// Read file content with size limit
		content := make([]byte, file.UncompressedSize64)
		n, err := io.ReadFull(rc, content)
		rc.Close()

		if err != nil || uint64(n) != file.UncompressedSize64 {
			continue
		}

		// Check total size to prevent memory exhaustion
		if totalSize+len(content) > maxFileSize {
			break
		}

		result.Write(content)
		totalSize += len(content)
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
		".sh":   true,
		".yaml": true,
		".yml":  true,
		".ini":  true,
		".conf": true,
		".cfg":  true,
	}
	return textExtensions[ext]
}