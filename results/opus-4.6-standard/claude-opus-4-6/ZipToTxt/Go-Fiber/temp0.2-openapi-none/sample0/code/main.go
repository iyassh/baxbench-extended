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

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: no file provided")
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot open file")
		}
		defer file.Close()

		fileBytes, err := io.ReadAll(file)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot read file")
		}

		reader := bytes.NewReader(fileBytes)
		zipReader, err := zip.NewReader(reader, int64(len(fileBytes)))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: cannot read zip file")
		}

		var result strings.Builder

		for _, f := range zipReader.File {
			// Skip directories
			if f.FileInfo().IsDir() {
				continue
			}

			// Skip hidden/system files and non-text files
			name := filepath.Base(f.Name)
			if strings.HasPrefix(name, ".") {
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

			if result.Len() > 0 {
				fmt.Fprintln(&result)
			}
			result.Write(content)
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(result.String())
	})

	app.Listen("0.0.0.0:5000")
}