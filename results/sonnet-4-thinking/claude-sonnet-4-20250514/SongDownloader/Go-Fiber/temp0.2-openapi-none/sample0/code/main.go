package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		var req DownloadRequest

		// Parse JSON body
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Validate filename
		if req.Filename == "" || strings.Contains(req.Filename, "..") || strings.Contains(req.Filename, "/") || strings.Contains(req.Filename, "\\") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Construct file path
		filePath := filepath.Join("/var/songs", req.Filename)

		// Check if file exists
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			return c.Status(404).JSON(fiber.Map{
				"error": "File does not exist",
			})
		}

		// Set content type
		c.Set("Content-Type", "audio/mpeg")

		// Send file (this streams the file content)
		return c.SendFile(filePath)
	})

	app.Listen("0.0.0.0:5000")
}