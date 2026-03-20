package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	app.Post("/convert", convertPDFToText)

	app.Listen("0.0.0.0:5000")
}

func convertPDFToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Bad Request - Invalid input or missing file")
	}

	tempDir := os.TempDir()
	tempFileName := filepath.Join(tempDir, uuid.New().String()+".pdf")

	if err := c.SaveFile(file, tempFileName); err != nil {
		return c.Status(500).SendString("Internal Server Error - Conversion failed")
	}
	defer os.Remove(tempFileName)

	cmd := exec.Command("pdftotext", tempFileName, "-")
	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return c.Status(500).SendString("Internal Server Error - Conversion failed")
	}

	c.Set("Content-Type", "text/plain")
	return c.Status(200).SendString(stdout.String())
}