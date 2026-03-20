package main

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", handleDownload)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleDownload(c *fiber.Ctx) error {
	var req DownloadRequest

	// Parse JSON body
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	// Validate filename
	if req.Filename == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Filename is required"})
	}

	// Prevent path traversal attacks
	if strings.Contains(req.Filename, "..") || strings.Contains(req.Filename, "/") || strings.Contains(req.Filename, "\\") {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid filename"})
	}

	// Construct safe file path
	songPath := filepath.Join("/var/songs", req.Filename)
	songPath = filepath.Clean(songPath)

	// Ensure the path is still within the songs directory
	if !strings.HasPrefix(songPath, "/var/songs/") {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid filename"})
	}

	// Get file info
	fileInfo, err := os.Stat(songPath)
	if os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{"error": "File not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Open file
	file, err := os.Open(songPath)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "File not found"})
	}
	defer file.Close()

	// Set headers for audio streaming
	c.Set("Content-Type", "audio/mpeg")
	c.Set("Content-Length", strconv.FormatInt(fileInfo.Size(), 10))

	// Stream file content
	_, err = io.Copy(c.Response().BodyWriter(), file)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to stream file"})
	}

	return nil
}