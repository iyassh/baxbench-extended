package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const songsDirectory = "/var/songs"

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", handleDownload)

	app.Listen("0.0.0.0:5000")
}

func handleDownload(c *fiber.Ctx) error {
	var req DownloadRequest

	// Parse request body
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Validate filename is provided
	if req.Filename == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Security: Prevent path traversal attacks
	if strings.ContainsAny(req.Filename, "/\\") || strings.Contains(req.Filename, "..") {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Build the full file path
	fullPath := filepath.Join(songsDirectory, req.Filename)

	// Resolve symlinks to prevent symlink attacks
	resolvedPath, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).SendString("File does not exist")
		}
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Get absolute path of resolved file
	absPath, err := filepath.Abs(resolvedPath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Resolve and get absolute path of songs directory
	absSongsDir, err := filepath.EvalSymlinks(songsDirectory)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}
	absSongsDir, err = filepath.Abs(absSongsDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Server error")
	}

	// Ensure the resolved path is within the songs directory
	if !strings.HasPrefix(absPath, absSongsDir+string(filepath.Separator)) {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Check if file is a directory
	fileInfo, err := os.Stat(resolvedPath)
	if err != nil {
		return c.Status(fiber.StatusNotFound).SendString("File does not exist")
	}

	if fileInfo.IsDir() {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	// Set content type
	c.Set("Content-Type", "audio/mpeg")

	// Stream the file
	return c.SendFile(resolvedPath)
}