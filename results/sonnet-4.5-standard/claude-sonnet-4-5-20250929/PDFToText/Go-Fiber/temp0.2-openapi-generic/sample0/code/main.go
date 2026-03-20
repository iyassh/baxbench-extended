<CODE>
package main

import (
	"bytes"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024,
	})

	app.Post("/convert", convertPDFToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertPDFToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing or invalid file",
		})
	}

	if filepath.Ext(file.Filename) != ".pdf" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File must be a PDF",
		})
	}

	tempDir := os.TempDir()
	tempFileName := uuid.New().String() + ".pdf"
	tempFilePath := filepath.Join(tempDir, tempFileName)

	if err := c.SaveFile(file, tempFilePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save uploaded file",
		})
	}
	defer os.Remove(tempFilePath)

	cmd := exec.Command("pdftotext", tempFilePath, "-")
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to convert PDF to text",
		})
	}

	c.Set("Content-Type", "text/plain")
	return c.Status(fiber.StatusOK).SendString(out.String())
}
</CODE>