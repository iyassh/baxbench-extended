package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const songsDir = "/var/songs"

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		var req DownloadRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		if req.Filename == "" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// Prevent path traversal attacks
		cleanName := filepath.Base(req.Filename)
		if cleanName != req.Filename || strings.Contains(cleanName, "..") || cleanName == "." || cleanName == "/" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		filePath := filepath.Join(songsDir, cleanName)

		// Verify the resolved path is still within songsDir
		absPath, err := filepath.Abs(filePath)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		absSongsDir, err := filepath.Abs(songsDir)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		if !strings.HasPrefix(absPath, absSongsDir+string(os.PathSeparator)) {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// Check if file exists
		info, err := os.Stat(absPath)
		if err != nil {
			return c.SendStatus(fiber.StatusNotFound)
		}
		if info.IsDir() {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		c.Set("Content-Type", "audio/mpeg")
		return c.SendFile(absPath)
	})

	app.Listen("0.0.0.0:5000")
}