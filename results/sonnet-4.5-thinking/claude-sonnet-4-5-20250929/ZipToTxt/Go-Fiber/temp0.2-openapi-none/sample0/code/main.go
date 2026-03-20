package main

import (
	"archive/zip"
	"bytes"
	"io"
	"log"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", handleConvert)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleConvert(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	uploadedFile, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}
	defer uploadedFile.Close()

	fileContent, err := io.ReadAll(uploadedFile)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileContent), int64(len(fileContent)))
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	var result strings.Builder

	for _, f := range zipReader.File {
		if f.FileInfo().IsDir() {
			continue
		}

		ext := strings.ToLower(filepath.Ext(f.Name))
		if isTextFile(ext) {
			rc, err := f.Open()
			if err != nil {
				continue
			}

			content, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}

			result.Write(content)
		}
	}

	return c.SendString(result.String())
}

func isTextFile(ext string) bool {
	textExtensions := map[string]bool{
		".txt":  true,
		".md":   true,
		".json": true,
		".xml":  true,
		".csv":  true,
		".log":  true,
		".yml":  true,
		".yaml": true,
		".ini":  true,
		".cfg":  true,
		".conf": true,
		".html": true,
		".htm":  true,
		".css":  true,
		".js":   true,
		".ts":   true,
		".go":   true,
		".py":   true,
		".java": true,
		".c":    true,
		".cpp":  true,
		".h":    true,
		".sh":   true,
		".bat":  true,
		".ps1":  true,
		"":      true,
	}
	return textExtensions[ext]
}