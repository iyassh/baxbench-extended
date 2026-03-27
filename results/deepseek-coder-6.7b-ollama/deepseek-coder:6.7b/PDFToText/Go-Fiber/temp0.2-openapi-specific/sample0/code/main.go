package main

import (
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
			return c.Status(400).SendString("Bad Request - Invalid input or missing file")
		}

		tempFile, err := ioutil.TempFile("", "upload_*.pdf")
		if err != nil {
			return c.Status(500).SendString("Internal Server Error - Unable to create temporary file")
		}

		defer os.Remove(tempFile.Name())

		if err := c.SaveFile(file, tempFile.Name()); err != nil {
			return c.Status(500).SendString("Internal Server Error - Unable to save file")
		}

		out, err := exec.Command("pdftotext", tempFile.Name(), "-").Output()
		if err != nil {
			return c.Status(500).SendString("Internal Server Error - Conversion failed")
		}

		return c.Status(200).SendString(string(out))
	})

	app.Listen(":5000")
}