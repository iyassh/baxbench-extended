package main

import (
	"archive/zip"
	"bytes"
	"io"
	"io/ioutil"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		fileData, err := file.Open()
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		defer fileData.Close()

		reader, err := zip.NewReader(fileData, file.Size)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}

		var contentBuilder strings.Builder
		for _, file := range reader.File {
			fileReader, err := file.Open()
			if err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}
			defer fileReader.Close()

			content, err := ioutil.ReadAll(fileReader)
			if err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}
			contentBuilder.Write(content)
		}

		tempFile, err := ioutil.TempFile("", "*.txt")
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		defer os.Remove(tempFile.Name())

		_, err = io.Copy(tempFile, strings.NewReader(contentBuilder.String()))
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}

		return c.Download(tempFile.Name())
	})

	log.Fatal(app.Listen(":5000"))
}