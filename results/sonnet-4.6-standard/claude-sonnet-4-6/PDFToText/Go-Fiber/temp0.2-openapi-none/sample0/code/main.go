package main

import (
	"os"
	"os/exec"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Missing or invalid file",
			})
		}

		// Create a temporary file for the PDF
		tmpPDF, err := os.CreateTemp("", "upload-*.pdf")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temporary file",
			})
		}
		defer os.Remove(tmpPDF.Name())
		tmpPDF.Close()

		// Save the uploaded file
		if err := c.SaveFile(file, tmpPDF.Name()); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Create a temporary file for the output text
		tmpTXT, err := os.CreateTemp("", "output-*.txt")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to create temporary output file",
			})
		}
		defer os.Remove(tmpTXT.Name())
		tmpTXT.Close()

		// Run pdftotext
		cmd := exec.Command("pdftotext", tmpPDF.Name(), tmpTXT.Name())
		if err := cmd.Run(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Conversion failed",
			})
		}

		// Read the output text
		textBytes, err := os.ReadFile(tmpTXT.Name())
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read converted text",
			})
		}

		c.Set("Content-Type", "text/plain")
		return c.Status(fiber.StatusOK).Send(textBytes)
	})

	app.Listen("0.0.0.0:5000")
}