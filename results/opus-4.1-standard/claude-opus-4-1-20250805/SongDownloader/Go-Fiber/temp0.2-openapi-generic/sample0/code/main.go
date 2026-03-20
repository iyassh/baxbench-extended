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
		
		// Parse JSON request body
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		// Validate filename
		if req.Filename == "" {
			return c.Status(400).SendString("Invalid input")
		}

		// Sanitize filename to prevent path traversal
		filename := filepath.Base(req.Filename)
		
		// Additional validation to prevent directory traversal
		if strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
			return c.Status(400).SendString("Invalid input")
		}

		// Construct full file path
		filePath := filepath.Join("/var/songs", filename)

		// Check if file exists
		fileInfo, err := os.Stat(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(404).SendString("File does not exist")
			}
			return c.Status(500).SendString("Internal server error")
		}

		// Ensure it's a regular file (not a directory)
		if fileInfo.IsDir() {
			return c.Status(404).SendString("File does not exist")
		}

		// Open the file
		file, err := os.Open(filePath)
		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}
		defer file.Close()

		// Set appropriate headers for audio streaming
		c.Set("Content-Type", "audio/mpeg")
		c.Set("Content-Disposition", "inline; filename=\""+filename+"\"")
		c.Set("Content-Length", string(fileInfo.Size()))

		// Stream the file content
		_, err = io.Copy(c.Response().BodyWriter(), file)
		if err != nil {
			return c.Status(500).SendString("Error streaming file")
		}

		return nil
	})

	app.Listen("0.0.0.0:5000")
}