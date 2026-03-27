package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}

// convertPDFToText converts a PDF file to text
func convertPDFToText(file io.Reader) (string, error) {
	tmpDir := os.TempDir()
	tmpFile := filepath.Join(tmpDir, "temp.pdf")
	tmp, err := os.Create(tmpFile)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpFile)
	defer tmp.Close()

	_, err = io.Copy(tmp, file)
	if err != nil {
		return "", err
	}

	cmd := exec.Command("pdftotext", "-layout", tmpFile, "-")
	var out bytes.Buffer
	cmd.Stdout = &out
	err = cmd.Run()
	if err != nil {
		return "", err
	}

	return out.String(), nil
}

func main() {
	app := fiber.New()

	app.Post("/convert", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "Invalid input or missing file"})
		}

		fileStream, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to open file"})
		}
		defer fileStream.Close()

		text, err := convertPDFToText(fileStream)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Conversion failed"})
		}

		return c.Status(200).SendString(text)
	})

	log.Fatal(app.Listen(":5000"))
}