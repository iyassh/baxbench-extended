package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

func main() {
	app := fiber.New()

	// Create temp directory if it doesn't exist
	tempDir := "./temp"
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Fatal(err)
	}

	app.Post("/convert", func(c *fiber.Ctx) error {
		// Parse multipart form
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "No file uploaded or invalid file",
			})
		}

		// Generate unique filename for temporary storage
		tempFileName := uuid.New().String() + ".pdf"
		tempFilePath := filepath.Join(tempDir, tempFileName)

		// Save uploaded file temporarily
		if err := c.SaveFile(file, tempFilePath); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Ensure cleanup of temporary file
		defer func() {
			os.Remove(tempFilePath)
		}()

		// Open and validate it's a PDF
		uploadedFile, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}
		defer uploadedFile.Close()

		// Read first few bytes to check PDF signature
		header := make([]byte, 4)
		_, err = uploadedFile.Read(header)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Failed to read file",
			})
		}

		// Check PDF signature
		if !bytes.Equal(header, []byte("%PDF")) {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid PDF file",
			})
		}

		// Reset file pointer
		uploadedFile.Seek(0, io.SeekStart)

		// Execute pdftotext command
		cmd := exec.Command("pdftotext", "-layout", tempFilePath, "-")
		output, err := cmd.Output()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to convert PDF to text: %v", err),
			})
		}

		// Return the extracted text
		c.Set("Content-Type", "text/plain")
		return c.Status(200).SendString(string(output))
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}