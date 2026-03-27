package main

import (
	"bytes"
	"archive/zip"
	"io"
	"github.com/gofiber/fiber/v2"
)

func convert(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	r, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}
	defer r.Close()

	zipReader, err := zip.NewReader(r, file.Size)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	var buf bytes.Buffer
	for _, f := range zipReader.File {
		rc, err := f.Open()
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		_, err = io.Copy(&buf, rc)
		rc.Close()
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}
	}

	return c.SendString(buf.String())
}

func main() {
	app := fiber.New()

	app.Post("/convert", convert)

	app.Listen(":5000")
}