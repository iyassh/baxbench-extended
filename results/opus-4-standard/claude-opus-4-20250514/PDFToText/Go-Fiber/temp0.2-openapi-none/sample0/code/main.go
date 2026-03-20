package main

import (
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
	os.MkdirAll("./temp", 0755)

	app.Post("/convert", func(c *fiber.Ctx) error {
		// Parse multipart form
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "No file uploaded",
			})
		}

		// Generate unique filename
		tempFileName := fmt.Sprintf("./temp/%s.pdf", uuid.New().String())
		
		// Save uploaded file
		if err := c.SaveFile(file, tempFileName); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save uploaded file",
			})
		}
		
		// Clean up temp file after processing
		defer os.Remove(tempFileName)

		// Execute pdftotext command
		cmd := exec.Command("pdftotext", "-layout", tempFileName, "-")
		output, err := cmd.Output()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to convert PDF to text",
			})
		}

		// Return plain text
		c.Set("Content-Type", "text/plain")
		return c.Send(output)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}