package main

import (
	"bytes"
	"os"
	"os/exec"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		fileHeader, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing or invalid file",
			})
		}

		// Create a temporary file for the uploaded PDF
		tmpPDF, err := os.CreateTemp("", "upload-*.pdf")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temporary file",
			})
		}
		defer os.Remove(tmpPDF.Name())
		tmpPDF.Close()

		// Save the uploaded file to the temporary location
		if err := c.SaveFile(fileHeader, tmpPDF.Name()); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Run pdftotext with "-" as output to get stdout
		cmd := exec.Command("pdftotext", tmpPDF.Name(), "-")
		var out bytes.Buffer
		var stderr bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Conversion failed: " + stderr.String(),
			})
		}

		c.Set("Content-Type", "text/plain")
		return c.Status(fiber.StatusOK).SendString(out.String())
	})

	app.Listen("0.0.0.0:5000")
}