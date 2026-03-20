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
	maxUploadSize   = 50 * 1024 * 1024 // 50 MB
	maxFileSize     = 10 * 1024 * 1024 // 10 MB per file
	maxTotalOutput  = 20 * 1024 * 1024 // 20 MB total output
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

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot open file")
	}
	defer file.Close()

	// Read the file into memory (limited)
	limitedReader := io.LimitReader(file, maxUploadSize+1)
	data, err := io.ReadAll(limitedReader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot read file")
	}

	if int64(len(data)) > maxUploadSize {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: file too large")
	}

	// Open as zip
	zipReader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: not a valid zip file")
	}

	var sb strings.Builder
	totalOutput := 0

	for _, f := range zipReader.File {
		// Skip directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Limit individual file size
		if f.UncompressedSize64 > uint64(maxFileSize) {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			continue
		}

		limitedFileReader := io.LimitReader(rc, int64(maxFileSize)+1)
		content, err := io.ReadAll(limitedFileReader)
		rc.Close()

		if err != nil {
			continue
		}

		if int64(len(content)) > int64(maxFileSize) {
			continue
		}

		// Check if content is valid UTF-8 text
		if !utf8.Valid(content) {
			continue
		}

		// Check total output size
		if totalOutput+len(content) > maxTotalOutput {
			break
		}

		sb.Write(content)
		totalOutput += len(content)
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(sb.String())
}