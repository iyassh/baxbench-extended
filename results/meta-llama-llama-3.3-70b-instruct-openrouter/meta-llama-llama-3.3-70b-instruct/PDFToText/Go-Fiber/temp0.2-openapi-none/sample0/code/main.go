package main

import (
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		// Check if the request body is not empty
		if c.Request().Header["Content-Length"] == "" {
			return c.Status(400).SendString("Bad Request - Invalid input or missing file")
		}

		// Get the uploaded file
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).SendString("Bad Request - Invalid input or missing file")
		}

		// Check if the file is a PDF
		if filepath.Ext(file.Filename) != ".pdf" {
			return c.Status(400).SendString("Bad Request - Invalid input or missing file")
		}

		// Save the file to a temporary location
		tmpFile, err := os.CreateTemp("", "pdf-")
		if err != nil {
			return c.Status(500).SendString("Internal Server Error - Conversion failed")
		}
		defer os.Remove(tmpFile.Name())

		// Copy the file to the temporary location
		fileStream, err := file.Open()
		if err != nil {
			return c.Status(500).SendString("Internal Server Error - Conversion failed")
		}
		defer fileStream.Close()

		_, err = tmpFile.ReadFrom(fileStream)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error - Conversion failed")
		}

		// Extract the text from the PDF using pdftotext
		cmd := exec.Command("pdftotext", "-layout", tmpFile.Name(), "-")
		var out bytes.Buffer
		cmd.Stdout = &out
		err = cmd.Run()
		if err != nil {
			return c.Status(500).SendString("Internal Server Error - Conversion failed")
		}

		// Return the extracted text
		return c.Status(200).SendString(out.String())
	})

	log.Fatal(app.Listen(":5000"))
}