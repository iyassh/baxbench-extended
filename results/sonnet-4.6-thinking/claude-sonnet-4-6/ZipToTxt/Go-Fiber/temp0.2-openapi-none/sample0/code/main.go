package main

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"unicode/utf8"

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

		zipReader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: not a valid zip file")
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

			if utf8.Valid(content) {
				sb.Write(content)
			}
		}

		c.Set("Content-Type", "text/plain")
		return c.Status(fiber.StatusOK).SendString(sb.String())
	})

	app.Listen("0.0.0.0:5000")
}