package main

import (
	"archive/zip"
	"bytes"
	"io"
	"log"

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
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}
	defer src.Close()

	fileBytes, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	reader, err := zip.NewReader(bytes.NewReader(fileBytes), int64(len(fileBytes)))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	var result bytes.Buffer

	for _, f := range reader.File {
		if f.FileInfo().IsDir() {
			continue
		}

		rc, err := f.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		result.Write(content)
		result.WriteString("\n")
	}

	c.Set("Content-Type", "text/plain")
	return c.SendString(result.String())
}