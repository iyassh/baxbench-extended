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
	app := fiber.New()

	app.Post("/convert", convertPDFToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertPDFToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Missing file")
	}

	if filepath.Ext(file.Filename) != ".pdf" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid file format. Only PDF files are allowed")
	}

	tempDir := os.TempDir()
	tempFileName := filepath.Join(tempDir, uuid.New().String()+".pdf")

	if err := c.SaveFile(file, tempFileName); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to save file")
	}
	defer os.Remove(tempFileName)

	cmd := exec.Command("pdftotext", tempFileName, "-")
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to convert PDF to text")
	}

	c.Set("Content-Type", "text/plain")
	return c.Status(fiber.StatusOK).SendString(out.String())
}
</CODE>