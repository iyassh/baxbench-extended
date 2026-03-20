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
		return c.Status(400).SendString("Bad Request - Invalid input or missing file")
	}

	if !strings.HasSuffix(strings.ToLower(file.Filename), ".pdf") {
		return c.Status(400).SendString("Bad Request - File must be a PDF")
	}

	tempID := uuid.New().String()
	tempPDFPath := filepath.Join(os.TempDir(), fmt.Sprintf("%s.pdf", tempID))
	tempTxtPath := filepath.Join(os.TempDir(), fmt.Sprintf("%s.txt", tempID))

	defer func() {
		os.Remove(tempPDFPath)
		os.Remove(tempTxtPath)
	}()

	if err := c.SaveFile(file, tempPDFPath); err != nil {
		return c.Status(500).SendString("Internal Server Error - Failed to save file")
	}

	cmd := exec.Command("pdftotext", tempPDFPath, tempTxtPath)
	if err := cmd.Run(); err != nil {
		return c.Status(500).SendString("Internal Server Error - Conversion failed")
	}

	txtFile, err := os.Open(tempTxtPath)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error - Failed to read converted text")
	}
	defer txtFile.Close()

	textContent, err := io.ReadAll(txtFile)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error - Failed to read converted text")
	}

	c.Set("Content-Type", "text/plain")
	return c.Status(200).Send(textContent)
}