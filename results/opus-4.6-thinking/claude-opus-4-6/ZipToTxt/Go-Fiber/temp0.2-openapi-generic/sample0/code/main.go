package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Post("/convert", handleConvert)

	app.Listen("0.0.0.0:5000")
}

func isTextFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	textExtensions := map[string]bool{
		".txt":  true,
		".csv":  true,
		".log":  true,
		".md":   true,
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
		".h":    true,
		".cpp":  true,
		".rs":   true,
		".rb":   true,
		".php":  true,
		".sh":   true,
		".bat":  true,
		".yaml": true,
		".yml":  true,
		".toml": true,
		".ini":  true,
		".cfg":  true,
		".conf": true,
		".sql":  true,
		".ts":   true,
		".jsx":  true,
		".tsx":  true,
		".svg":  true,
		"":      true,
	}
	return textExtensions[ext]
}

func handleConvert(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("No file uploaded")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Failed to open uploaded file")
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Failed to read uploaded file")
	}

	reader := bytes.NewReader(fileBytes)
	zipReader, err := zip.NewReader(reader, int64(len(fileBytes)))
	if err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid zip file")
	}

	var result strings.Builder

	for _, f := range zipReader.File {
		// Skip directories
		if f.FileInfo().IsDir() {
			continue
		}

		// Sanitize file path to prevent zip slip
		cleanName := filepath.Clean(f.Name)
		if strings.HasPrefix(cleanName, "..") || strings.HasPrefix(cleanName, "/") {
			continue
		}

		// Check if it's likely a text file
		if !isTextFile(f.Name) {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			continue
		}

		// Limit individual file read to 10MB
		limitedReader := io.LimitReader(rc, 10*1024*1024)
		content, err := io.ReadAll(limitedReader)
		rc.Close()
		if err != nil {
			continue
		}

		// Only include if content is valid UTF-8 text
		if !utf8.Valid(content) {
			continue
		}

		if result.Len() > 0 {
			result.WriteString("\n")
		}
		result.WriteString(fmt.Sprintf("--- %s ---\n", cleanName))
		result.Write(content)
	}

	c.Set("Content-Type", "text/plain; charset=utf-8")
	return c.SendString(result.String())
}