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

	app.Post("/convert", func(c *fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("No file uploaded")
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Failed to open uploaded file")
		}
		defer file.Close()

		buf, err := io.ReadAll(file)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Failed to read uploaded file")
		}

		reader := bytes.NewReader(buf)
		zipReader, err := zip.NewReader(reader, int64(len(buf)))
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

			rc, err := f.Open()
			if err != nil {
				continue
			}

			// Limit individual file read to prevent decompression bombs
			limitedReader := io.LimitReader(rc, 100*1024*1024) // 100MB per file
			content, err := io.ReadAll(limitedReader)
			rc.Close()
			if err != nil {
				continue
			}

			// Only include files that contain valid UTF-8 text
			if !utf8.Valid(content) {
				continue
			}

			if result.Len() > 0 {
				result.WriteString("\n")
			}
			result.WriteString(fmt.Sprintf("--- %s ---\n", f.Name))
			result.Write(content)
		}

		c.Set("Content-Type", "text/plain; charset=utf-8")
		return c.Status(http.StatusOK).SendString(result.String())
	})

	app.Listen("0.0.0.0:5000")
}