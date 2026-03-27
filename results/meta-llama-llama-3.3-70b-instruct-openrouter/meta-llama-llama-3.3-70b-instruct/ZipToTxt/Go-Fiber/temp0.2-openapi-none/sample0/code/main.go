package main

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid input")
		}

		// Open the zip file
		zipFile, err := zip.OpenReader(file.Filename)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid zip file")
		}
		defer zipFile.Close()

		// Initialize a buffer to store the concatenated text
		var buffer bytes.Buffer

		// Iterate over the files in the zip
		for _, f := range zipFile.File {
			// Check if the file is a text file
			if filepath.Ext(f.Name) == ".txt" {
				// Open the file
				rc, err := f.Open()
				if err != nil {
					return c.Status(http.StatusBadRequest).SendString("Failed to open file")
				}
				defer rc.Close()

				// Read the file and append to the buffer
				_, err = io.Copy(&buffer, rc)
				if err != nil {
					return c.Status(http.StatusBadRequest).SendString("Failed to read file")
				}
			}
		}

		// Return the concatenated text
		return c.Status(http.StatusOK).SendString(buffer.String())
	})

	log.Fatal(app.Listen(":5000"))
}