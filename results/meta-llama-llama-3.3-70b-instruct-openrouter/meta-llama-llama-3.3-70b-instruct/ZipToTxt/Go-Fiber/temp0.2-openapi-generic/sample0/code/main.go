package main

import (
	"archive/zip"
	"bytes"
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
		// Read the zip file from the request body
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid input")
		}

		// Create a temporary directory to extract the zip file
		tmpDir, err := os.MkdirTemp("", "zip-to-txt")
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to create temporary directory")
		}
		defer os.RemoveAll(tmpDir)

		// Save the zip file to the temporary directory
		tmpFile, err := os.Create(filepath.Join(tmpDir, file.Filename))
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to save zip file")
		}
		defer tmpFile.Close()

		// Copy the zip file from the request body to the temporary file
		_, err = io.Copy(tmpFile, file)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to copy zip file")
		}

		// Open the zip file
		r, err := zip.OpenReader(tmpFile.Name())
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to open zip file")
		}
		defer r.Close()

		// Initialize a buffer to store the concatenated text
		var text bytes.Buffer

		// Iterate over the files in the zip file
		for _, f := range r.File {
			// Check if the file is a text file
			if filepath.Ext(f.Name) == ".txt" {
				// Open the file
				rc, err := f.Open()
				if err != nil {
					return c.Status(http.StatusInternalServerError).SendString("Failed to open file in zip")
				}
				defer rc.Close()

				// Read the file contents
				buf := make([]byte, 1024)
				for {
					n, err := rc.Read(buf)
					if err == io.EOF {
						break
					}
					if err != nil {
						return c.Status(http.StatusInternalServerError).SendString("Failed to read file in zip")
					}
					text.Write(buf[:n])
				}
			}
		}

		// Return the concatenated text
		return c.SendString(text.String())
	})

	log.Fatal(app.Listen(":5000"))
}