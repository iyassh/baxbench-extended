package main

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

const (
	maxUploadSize    = 50 * 1024 * 1024 // 50 MB
	maxFileSize      = 10 * 1024 * 1024 // 10 MB per file
	maxTotalTextSize = 50 * 1024 * 1024 // 50 MB total text output
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit:             maxUploadSize,
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusBadRequest).SendString("Bad request")
		},
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

	app.Listen("0.0.0.0:5000")
}

func handleConvert(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: no file provided")
	}

	// Check file size
	if fileHeader.Size > maxUploadSize {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: file too large")
	}

	// Open the uploaded file
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot open file")
	}
	defer file.Close()

	// Read file content into memory (limited)
	limitedReader := io.LimitReader(file, maxUploadSize+1)
	fileBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot read file")
	}

	if int64(len(fileBytes)) > maxUploadSize {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: file too large")
	}

	// Open as zip
	zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: not a valid zip file")
	}

	var sb strings.Builder
	totalSize := 0

	for _, f := range zipReader.File {
		// Skip directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Prevent zip slip: check for path traversal
		name := f.Name
		if strings.Contains(name, "..") {
			continue
		}

		// Limit individual file size
		if f.UncompressedSize64 > maxFileSize {
			continue
		}

		// Open the file inside zip
		rc, err := f.Open()
		if err != nil {
			continue
		}

		// Read with limit
		limitedFileReader := io.LimitReader(rc, maxFileSize+1)
		content, err := io.ReadAll(limitedFileReader)
		rc.Close()

		if err != nil {
			continue
		}

		if int64(len(content)) > maxFileSize {
			continue
		}

		// Check if content is valid UTF-8 text
		if !utf8.Valid(content) {
			continue
		}

		// Check total size limit
		totalSize += len(content)
		if totalSize > maxTotalTextSize {
			break
		}

		sb.Write(content)
		// Add newline between files if content doesn't end with newline
		if len(content) > 0 && content[len(content)-1] != '\n' {
			sb.WriteByte('\n')
		}
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(sb.String())
}