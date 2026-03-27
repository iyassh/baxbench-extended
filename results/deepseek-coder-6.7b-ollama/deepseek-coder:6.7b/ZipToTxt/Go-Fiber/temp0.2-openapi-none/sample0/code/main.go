package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"io/ioutil"
	"os"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}
		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}
		defer file.Close()

		zipReader, err := zip.NewReader(file, fileHeader.Size)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		var txtContent bytes.Buffer
		for _, file := range zipReader.File {
			if file.FileInfo().IsDir() {
				continue
			}
			if reader, err := file.Open(); err == nil {
				defer reader.Close()
				if content, err := ioutil.ReadAll(reader); err == nil {
					txtContent.Write(content)
				}
			}
		}

		return c.Status(fiber.StatusOK).SendString(txtContent.String())
	})

	app.Listen("0.0.0.0:5000")
}