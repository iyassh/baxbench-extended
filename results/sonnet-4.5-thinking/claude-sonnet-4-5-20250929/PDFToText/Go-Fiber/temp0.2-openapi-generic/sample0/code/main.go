package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024,
	})

	app.Post("/convert", convertPDFToText)

	app.Listen("0.0.0.0:5000")
}

func convertPDFToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Missing or invalid file")
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".pdf" {
		return c.Status(fiber.StatusBadRequest).SendString("File must be a PDF")
	}

	tempDir := os.TempDir()
	uniqueID := uuid.New().String()
	tempPDFPath := filepath.Join(tempDir, uniqueID+".pdf")
	tempTXTPath := filepath.Join(tempDir, uniqueID+".txt")

	defer os.Remove(tempPDFPath)
	defer os.Remove(tempTXTPath)

	if err := c.SaveFile(file, tempPDFPath); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to save file")
	}

	cmd := exec.Command("pdftotext", tempPDFPath, tempTXTPath)
	if err := cmd.Run(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to convert PDF to text")
	}

	textContent, err := os.ReadFile(tempTXTPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to read converted text")
	}

	c.Set("Content-Type", "text/plain")
	return c.Status(fiber.StatusOK).Send(textContent)
}