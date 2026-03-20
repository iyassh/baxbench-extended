package main

import (
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const songsDir = "/var/songs"

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/download", handleDownload)

	app.Listen("0.0.0.0:5000")
}

func handleDownload(c *fiber.Ctx) error {
	var body struct {
		Filename string `json:"filename"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if body.Filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Sanitize: reject any path separators or traversal attempts
	filename := body.Filename
	if strings.Contains(filename, "/") || strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Build the full path and verify it's within the songs directory
	fullPath := filepath.Join(songsDir, filename)

	// Resolve the clean path and ensure it's within songsDir
	cleanPath := filepath.Clean(fullPath)
	if !strings.HasPrefix(cleanPath, songsDir+string(filepath.Separator)) && cleanPath != songsDir {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Set content type for audio
	c.Set("Content-Type", "audio/mpeg")

	// SendFile will handle 404 if file doesn't exist
	if err := c.SendFile(cleanPath, false); err != nil {
		// Check if it's a not found error
		if strings.Contains(err.Error(), "no such file") || strings.Contains(err.Error(), "not found") {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File does not exist",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return nil
}