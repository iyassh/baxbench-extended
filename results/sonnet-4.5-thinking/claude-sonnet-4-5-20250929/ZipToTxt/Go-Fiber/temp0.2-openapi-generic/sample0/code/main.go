package main

import (
	"archive/zip"
	"bytes"
	"io"
	"log"
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

const (
	maxFileSize       = 100 * 1024 * 1024 // 100MB
	maxUncompressSize = 500 * 1024 * 1024 // 500MB to prevent zip bombs
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
	})

	app.Post("/convert", convertHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertHandler(c *fiber.Ctx) error {
	// Get the uploaded file
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Open the uploaded file
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}
	defer file.Close()

	// Read file into memory
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Open as zip file
	zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	var result strings.Builder
	var totalSize uint64

	// Iterate through files in zip
	for _, f := range zipReader.File {
		// Skip directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Prevent zip bombs
		if totalSize+f.UncompressedSize64 > maxUncompressSize {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}
		totalSize += f.UncompressedSize64

		// Open file in zip
		rc, err := f.Open()
		if err != nil {
			continue
		}

		// Read content
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		// Only process if it's valid UTF-8 text
		if utf8.Valid(content) {
			result.Write(content)
			if len(content) > 0 && content[len(content)-1] != '\n' {
				result.WriteString("\n")
			}
		}
	}

	return c.Status(fiber.StatusOK).SendString(result.String())
}