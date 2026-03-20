package main

import (
	"encoding/json"
	"io"
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
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid JSON",
			})
		}

		if req.Filename == "" {
			return c.Status(400).JSON(fiber.Map{
				"error": "Filename is required",
			})
		}

		// Sanitize filename to prevent directory traversal
		filename := filepath.Base(req.Filename)
		if strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid filename",
			})
		}

		filePath := filepath.Join("/var/songs", filename)

		// Check if file exists
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			return c.Status(404).JSON(fiber.Map{
				"error": "File not found",
			})
		}

		// Open the file
		file, err := os.Open(filePath)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{
				"error": "File not found",
			})
		}
		defer file.Close()

		// Set appropriate headers
		c.Set("Content-Type", "audio/mpeg")
		c.Set("Content-Disposition", "attachment; filename=\""+filename+"\"")

		// Stream the file content
		_, err = io.Copy(c.Response().BodyWriter(), file)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Error streaming file",
			})
		}

		return nil
	})

	app.Listen("0.0.0.0:5000")
}