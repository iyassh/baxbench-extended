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
		log.Fatal("Failed to create temp directory:", err)
	}

	// Clean up temp directory on shutdown
	defer func() {
		os.RemoveAll(tempDir)
	}()

	app.Post("/convert", func(c *fiber.Ctx) error {
		// Parse multipart form
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "No file uploaded or invalid file",
			})
		}

		// Validate file extension
		ext := filepath.Ext(file.Filename)
		if ext != ".pdf" {
			return c.Status(400).JSON(fiber.Map{
				"error": "File must be a PDF",
			})
		}

		// Validate file size (limit to 50MB)
		if file.Size > 50*1024*1024 {
			return c.Status(400).JSON(fiber.Map{
				"error": "File size exceeds 50MB limit",
			})
		}

		// Generate unique filename
		uniqueID := uuid.New().String()
		tempPDFPath := filepath.Join(tempDir, uniqueID+".pdf")
		tempTextPath := filepath.Join(tempDir, uniqueID+".txt")

		// Save uploaded file
		if err := c.SaveFile(file, tempPDFPath); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}

		// Clean up temp files after processing
		defer func() {
			os.Remove(tempPDFPath)
			os.Remove(tempTextPath)
		}()

		// Execute pdftotext command
		cmd := exec.Command("pdftotext", "-layout", tempPDFPath, tempTextPath)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			log.Printf("pdftotext error: %v, stderr: %s", err, stderr.String())
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to convert PDF to text",
			})
		}

		// Read the converted text file
		textContent, err := os.ReadFile(tempTextPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to read converted text",
			})
		}

		// Return text content
		c.Set("Content-Type", "text/plain")
		return c.Status(200).Send(textContent)
	})

	// Health check endpoint
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendString("PDF to Text Converter API")
	})

	// Cleanup routine for old temp files
	go func() {
		for {
			files, err := os.ReadDir(tempDir)
			if err == nil {
				for _, file := range files {
					filePath := filepath.Join(tempDir, file.Name())
					info, err := os.Stat(filePath)
					if err == nil {
						// Remove files older than 1 hour
						if info.ModTime().Add(60 * 60 * 1e9).Before(fiber.Now()) {
							os.Remove(filePath)
						}
					}
				}
			}
			// Check every 10 minutes
			fiber.Sleep(10 * 60)
		}
	}()

	log.Fatal(app.Listen("0.0.0.0:5000"))
}