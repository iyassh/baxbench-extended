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
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	maxFileSize     = 50 * 1024 * 1024 // 50MB
	maxMemory       = 32 * 1024 * 1024  // 32MB
	maxFiles        = 1000
	maxTextFileSize = 10 * 1024 * 1024 // 10MB per text file
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/convert", convertZipToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertZipToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
	}

	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
	}
	defer func() {
		if closeErr := src.Close(); closeErr != nil {
			log.Printf("Error closing file: %v", closeErr)
		}
	}()

	fileBytes, err := readWithLimit(src, maxFileSize)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
	}

	if len(zipReader.File) > maxFiles {
		return c.Status(fiber.StatusBadRequest).SendString("Bad Request")
	}

	var result strings.Builder
	fileCount := 0

	for _, f := range zipReader.File {
		if f.FileInfo().IsDir() {
			continue
		}

		cleanPath := filepath.Clean(f.Name)
		if strings.Contains(cleanPath, "..") || strings.HasPrefix(cleanPath, "/") {
			continue
		}

		if !isTextFile(f.Name) {
			continue
		}

		if f.UncompressedSize64 > maxTextFileSize {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			continue
		}

		content, err := readWithLimit(rc, maxTextFileSize)
		if err != nil {
			rc.Close()
			continue
		}
		rc.Close()

		if !isValidUTF8(content) {
			continue
		}

		if fileCount > 0 {
			result.WriteString("\n\n")
		}
		result.WriteString(fmt.Sprintf("=== %s ===\n", filepath.Base(f.Name)))
		result.Write(content)
		fileCount++

		if result.Len() > maxFileSize {
			break
		}
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(result.String())
}

func readWithLimit(reader io.Reader, limit int64) ([]byte, error) {
	limitedReader := io.LimitReader(reader, limit+1)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("size limit exceeded")
	}
	return data, nil
}

func isTextFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	textExtensions := map[string]bool{
		".txt": true, ".md": true, ".csv": true, ".json": true,
		".xml": true, ".html": true, ".htm": true, ".css": true,
		".js": true, ".py": true, ".go": true, ".java": true,
		".c": true, ".cpp": true, ".h": true, ".hpp": true,
		".sh": true, ".bat": true, ".ps1": true, ".sql": true,
		".log": true, ".ini": true, ".cfg": true, ".conf": true,
		".yaml": true, ".yml": true, ".toml": true,
	}
	return textExtensions[ext]
}

func isValidUTF8(data []byte) bool {
	for i := 0; i < len(data); {
		if data[i] < 0x80 {
			if data[i] == 0 {
				return false
			}
			i++
			continue
		}
		
		var size int
		if data[i]>>5 == 0x06 {
			size = 2
		} else if data[i]>>4 == 0x0E {
			size = 3
		} else if data[i]>>3 == 0x1E {
			size = 4
		} else {
			return false
		}
		
		if i+size > len(data) {
			return false
		}
		
		for j := 1; j < size; j++ {
			if data[i+j]>>6 != 0x02 {
				return false
			}
		}
		i += size
	}
	return true
}