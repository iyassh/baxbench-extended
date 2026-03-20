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
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Use(recover.New())
	app.Use(cors.New())

	app.Post("/convert", convertZipToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertZipToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("No file provided")
	}

	if file.Size == 0 {
		return c.Status(400).SendString("Empty file provided")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Failed to open file")
	}
	defer src.Close()

	fileBytes, err := io.ReadAll(src)
	if err != nil {
		return c.Status(400).SendString("Failed to read file")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(400).SendString("Invalid zip file")
	}

	var result strings.Builder

	for _, f := range zipReader.File {
		if f.FileInfo().IsDir() {
			continue
		}

		ext := strings.ToLower(filepath.Ext(f.Name))
		if !isTextFile(ext) {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			continue
		}

		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		result.WriteString(fmt.Sprintf("=== %s ===\n", f.Name))
		result.Write(content)
		result.WriteString("\n\n")
	}

	if result.Len() == 0 {
		return c.Status(400).SendString("No text files found in zip")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}

func isTextFile(ext string) bool {
	textExtensions := map[string]bool{
		".txt":  true,
		".md":   true,
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
		".php":  true,
		".rb":   true,
		".sh":   true,
		".sql":  true,
		".log":  true,
		".ini":  true,
		".cfg":  true,
		".conf": true,
		".yaml": true,
		".yml":  true,
		".toml": true,
		"":      true, // files without extension
	}
	return textExtensions[ext]
}