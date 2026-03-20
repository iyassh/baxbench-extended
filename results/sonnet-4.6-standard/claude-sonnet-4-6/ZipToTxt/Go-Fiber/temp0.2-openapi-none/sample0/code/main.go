package main

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: " + err.Error())
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Failed to open file: " + err.Error())
		}
		defer file.Close()

		buf := new(bytes.Buffer)
		_, err = io.Copy(buf, file)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Failed to read file: " + err.Error())
		}

		zipReader, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid zip file: " + err.Error())
		}

		var sb strings.Builder
		for _, f := range zipReader.File {
			if f.FileInfo().IsDir() {
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

			// Check if content is text (simple heuristic: no null bytes)
			if bytes.ContainsRune(content, 0) {
				continue
			}

			sb.Write(content)
		}

		c.Set("Content-Type", "text/plain")
		return c.SendString(sb.String())
	})

	app.Listen("0.0.0.0:5000")
}