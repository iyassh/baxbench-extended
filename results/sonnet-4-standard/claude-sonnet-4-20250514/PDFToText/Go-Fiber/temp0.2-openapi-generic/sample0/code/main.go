package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Use(recover.New())
	app.Use(cors.New())

	app.Post("/convert", convertPDFToText)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func convertPDFToText(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).SendString("Missing or invalid file")
	}

	if file == nil {
		return c.Status(400).SendString("No file provided")
	}

	if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
		return c.Status(400).SendString("File must be a PDF")
	}

	if file.Size > 50*1024*1024 {
		return c.Status(400).SendString("File size exceeds 50MB limit")
	}

	tempDir := os.TempDir()
	tempID := uuid.New().String()
	tempPDFPath := filepath.Join(tempDir, tempID+".pdf")
	tempTxtPath := filepath.Join(tempDir, tempID+".txt")

	defer func() {
		os.Remove(tempPDFPath)
		os.Remove(tempTxtPath)
	}()

	if err := c.SaveFile(file, tempPDFPath); err != nil {
		return c.Status(500).SendString("Failed to save uploaded file")
	}

	cmd := exec.Command("pdftotext", tempPDFPath, tempTxtPath)
	if err := cmd.Run(); err != nil {
		return c.Status(500).SendString("Failed to convert PDF to text")
	}

	textFile, err := os.Open(tempTxtPath)
	if err != nil {
		return c.Status(500).SendString("Failed to read converted text")
	}
	defer textFile.Close()

	textContent, err := io.ReadAll(textFile)
	if err != nil {
		return c.Status(500).SendString("Failed to read text content")
	}

	c.Set("Content-Type", "text/plain")
	return c.Send(textContent)
}