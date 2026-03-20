package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const (
	maxFileSize = 100 * 1024 * 1024 // 100MB max file size
	maxTextSize = 50 * 1024 * 1024  // 50MB max for individual text files
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
	})

	app.Post("/convert", handleConvert)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handleConvert(c *fiber.Ctx) error {
	// Get the uploaded file
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid input: no file provided")
	}

	// Open the uploaded file
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot open file")
	}
	defer file.Close()

	// Read file into memory
	fileData, err := io.ReadAll(file)
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot read file")
	}

	// Check if it's a valid zip file
	reader, err := zip.NewReader(bytes.NewReader(fileData), int64(len(fileData)))
	if err != nil {
		return c.Status(400).SendString("Invalid input: not a valid zip file")
	}

	// Extract and concatenate text files
	var result strings.Builder
	processedFiles := 0

	for _, zipFile := range reader.File {
		// Skip directories
		if zipFile.FileInfo().IsDir() {
			continue
		}

		// Validate file path to prevent directory traversal
		cleanPath := filepath.Clean(zipFile.Name)
		if strings.Contains(cleanPath, "..") {
			continue
		}

		// Check if it's a text file by extension
		if !isTextFile(zipFile.Name) {
			continue
		}

		// Check uncompressed size to prevent zip bombs
		if zipFile.UncompressedSize64 > maxTextSize {
			continue
		}

		// Open the file in the zip
		fileReader, err := zipFile.Open()
		if err != nil {
			continue
		}

		// Read the file content with size limit
		limitedReader := io.LimitReader(fileReader, maxTextSize)
		content, err := io.ReadAll(limitedReader)
		fileReader.Close()

		if err != nil {
			continue
		}

		// Validate that content is valid UTF-8 text
		contentStr := string(content)
		if !isValidUTF8(contentStr) {
			continue
		}

		// Add file separator if not the first file
		if processedFiles > 0 {
			result.WriteString("\n\n")
		}

		// Add file header
		result.WriteString(fmt.Sprintf("=== %s ===\n", zipFile.Name))
		result.WriteString(contentStr)
		
		processedFiles++
	}

	if processedFiles == 0 {
		return c.Status(400).SendString("Invalid input: no text files found in zip")
	}

	// Return the concatenated text
	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(result.String())
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
		".yaml": true,
		".yml":  true,
		".conf": true,
		".cfg":  true,
		".ini":  true,
		".properties": true,
	}
	return textExtensions[ext]
}

func isValidUTF8(s string) bool {
	for _, r := range s {
		if r == '\ufffd' {
			return false
		}
	}
	return true
}