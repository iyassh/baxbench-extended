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
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid input: no file provided")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot open file")
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot read file")
	}

	zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(400).SendString("Invalid input: not a valid zip file")
	}

	var result strings.Builder

	for _, f := range zipReader.File {
		if f.FileInfo().IsDir() {
			continue
		}

		ext := strings.ToLower(filepath.Ext(f.Name))
		if ext != ".txt" && ext != ".md" && ext != ".log" && ext != ".csv" && ext != ".json" && ext != ".xml" && ext != ".html" && ext != ".css" && ext != ".js" && ext != ".go" && ext != ".py" && ext != ".java" && ext != ".c" && ext != ".cpp" && ext != ".h" && ext != ".sh" && ext != ".yml" && ext != ".yaml" && ext != "" {
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

		if !isTextContent(content) {
			continue
		}

		result.WriteString("=== ")
		result.WriteString(f.Name)
		result.WriteString(" ===\n")
		result.Write(content)
		result.WriteString("\n\n")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}

func isTextContent(content []byte) bool {
	if len(content) == 0 {
		return true
	}

	sampleSize := len(content)
	if sampleSize > 512 {
		sampleSize = 512
	}

	for i := 0; i < sampleSize; i++ {
		b := content[i]
		if b < 32 && b != 9 && b != 10 && b != 13 {
			return false
		}
	}

	return true
}