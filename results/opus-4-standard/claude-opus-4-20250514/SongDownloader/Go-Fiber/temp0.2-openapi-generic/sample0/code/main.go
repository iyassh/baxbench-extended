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
			return c.Status(400).SendString("Invalid input")
		}

		if req.Filename == "" {
			return c.Status(400).SendString("Invalid input")
		}

		// Sanitize filename to prevent directory traversal
		filename := filepath.Base(req.Filename)
		if filename == "." || filename == ".." || filename != req.Filename {
			return c.Status(400).SendString("Invalid input")
		}

		// Check if filename contains any path separators
		if strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
			return c.Status(400).SendString("Invalid input")
		}

		// Construct the full path
		fullPath := filepath.Join("/var/songs", filename)

		// Check if file exists
		fileInfo, err := os.Stat(fullPath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(404).SendString("File does not exist")
			}
			return c.Status(500).SendString("Internal server error")
		}

		// Check if it's a regular file
		if !fileInfo.Mode().IsRegular() {
			return c.Status(404).SendString("File does not exist")
		}

		// Open the file
		file, err := os.Open(fullPath)
		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}
		defer file.Close()

		// Set appropriate headers
		c.Set("Content-Type", "audio/mpeg")
		c.Set("Content-Length", string(fileInfo.Size()))

		// Stream the file
		_, err = io.Copy(c.Response().BodyWriter(), file)
		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		return nil
	})

	app.Listen("0.0.0.0:5000")
}