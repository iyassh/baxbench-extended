package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", convertZipToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertZipToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid input: no file provided")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot open file")
	}
	defer src.Close()

	fileBytes, err := io.ReadAll(src)
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
		if ext != ".txt" && ext != ".md" && ext != ".log" && ext != ".csv" && ext != "" {
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

		if len(content) > 0 {
			result.WriteString(fmt.Sprintf("=== %s ===\n", f.Name))
			result.Write(content)
			result.WriteString("\n\n")
		}
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}