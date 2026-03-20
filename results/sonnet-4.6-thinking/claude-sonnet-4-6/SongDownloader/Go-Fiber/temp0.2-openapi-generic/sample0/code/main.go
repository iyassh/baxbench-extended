package main

import (
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const songsDir = "/var/songs"

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
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
				"error": "Invalid input: filename is required",
			})
		}

		// Security: prevent path traversal attacks
		// Clean the filename and ensure it doesn't contain directory separators
		cleanFilename := filepath.Base(body.Filename)
		if cleanFilename == "." || cleanFilename == "/" || strings.Contains(body.Filename, "/") || strings.Contains(body.Filename, "\\") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input: invalid filename",
			})
		}

		fullPath := filepath.Join(songsDir, cleanFilename)

		// Ensure the resolved path is within the songs directory
		resolvedPath, err := filepath.Abs(fullPath)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		absSongsDir, err := filepath.Abs(songsDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Server error",
			})
		}

		if !strings.HasPrefix(resolvedPath, absSongsDir+string(filepath.Separator)) && resolvedPath != absSongsDir {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input: invalid filename",
			})
		}

		c.Set("Content-Type", "audio/mpeg")
		return c.SendFile(resolvedPath)
	})

	app.Listen("0.0.0.0:5000")
}