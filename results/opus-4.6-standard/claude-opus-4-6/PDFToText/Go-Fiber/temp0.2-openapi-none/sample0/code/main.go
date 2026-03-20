package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
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

		tmpDir := os.TempDir()
		uniqueID := uuid.New().String()
		pdfPath := filepath.Join(tmpDir, fmt.Sprintf("%s.pdf", uniqueID))
		txtPath := filepath.Join(tmpDir, fmt.Sprintf("%s.txt", uniqueID))

		if err := c.SaveFile(file, pdfPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		defer os.Remove(pdfPath)
		defer os.Remove(txtPath)

		cmd := exec.Command("pdftotext", pdfPath, txtPath)
		if output, err := cmd.CombinedOutput(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("Conversion failed: %s %s", err.Error(), string(output)),
			})
		}

		textContent, err := os.ReadFile(txtPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to read converted text file",
			})
		}

		c.Set("Content-Type", "text/plain")
		return c.Status(fiber.StatusOK).Send(textContent)
	})

	app.Listen("0.0.0.0:5000")
}