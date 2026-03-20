package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

const (
	MaxFileSize      = 50 * 1024 * 1024  // 50MB
	MaxExtractedSize = 100 * 1024 * 1024 // 100MB total extracted size
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: MaxFileSize,
	})

	app.Post("/convert", convertHandler)

	app.Listen("0.0.0.0:5000")
}

func convertHandler(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("No file uploaded")
	}

	if file.Size > MaxFileSize {
		return c.Status(400).SendString("File too large")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Unable to open file")
	}
	defer src.Close()

	fileContent, err := io.ReadAll(src)
	if err != nil {
		return c.Status(400).SendString("Unable to read file")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
	if err != nil {
		return c.Status(400).SendString("Invalid zip file")
	}

	result, err := extractTextFiles(zipReader)
	if err != nil {
		return c.Status(400).SendString(err.Error())
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result)
}

func extractTextFiles(zipReader *zip.Reader) (string, error) {
	var result strings.Builder
	totalExtracted := int64(0)

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

		if totalExtracted+int64(file.UncompressedSize64) > MaxExtractedSize {
			return "", fmt.Errorf("extracted content too large")
		}

		rc, err := file.Open()
		if err != nil {
			continue
		}

		content, err := io.ReadAll(io.LimitReader(rc, MaxExtractedSize-totalExtracted))
		rc.Close()

		if err != nil {
			continue
		}

		if !utf8.Valid(content) {
			continue
		}

		result.WriteString(fmt.Sprintf("=== %s ===\n", file.Name))
		result.Write(content)
		result.WriteString("\n\n")

		totalExtracted += int64(len(content))
	}

	return result.String(), nil
}

func isValidPath(path string) bool {
	cleanPath := filepath.Clean(path)
	return !strings.Contains(cleanPath, "..") && !strings.HasPrefix(cleanPath, "/")
}

func isTextFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	textExtensions := []string{
		".txt", ".md", ".json", ".xml", ".yaml", ".yml",
		".csv", ".log", ".conf", ".cfg", ".ini", ".sh",
		".py", ".go", ".js", ".ts", ".html", ".css", ".sql",
		".c", ".cpp", ".h", ".java", ".rb", ".php", ".pl",
	}

	for _, textExt := range textExtensions {
		if ext == textExt {
			return true
		}
	}

	return false
}