package main

import (
	"archive/zip"
	"bytes"
	"io"
	"log"
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
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: file not provided")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: unable to open file")
	}
	defer src.Close()

	fileData, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: unable to read file")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileData), int64(len(fileData)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: not a valid zip file")
	}

	var result strings.Builder

	for _, zipFile := range zipReader.File {
		if zipFile.FileInfo().IsDir() {
			continue
		}

		if !isTextFile(zipFile.Name) {
			continue
		}

		rc, err := zipFile.Open()
		if err != nil {
			continue
		}

		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}

		result.Write(content)
		result.WriteString("\n")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}

func isTextFile(filename string) bool {
	textExtensions := []string{
		".txt", ".md", ".json", ".xml", ".yaml", ".yml",
		".csv", ".log", ".html", ".htm", ".css", ".js",
		".go", ".py", ".java", ".c", ".cpp", ".h", ".sh",
		".sql", ".conf", ".config", ".properties", ".env",
	}

	filename = strings.ToLower(filename)
	for _, ext := range textExtensions {
		if strings.HasSuffix(filename, ext) {
			return true
		}
	}

	return false
}