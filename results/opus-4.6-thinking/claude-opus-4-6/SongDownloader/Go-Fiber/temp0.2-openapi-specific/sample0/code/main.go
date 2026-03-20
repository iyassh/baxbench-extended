package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

const songsDir = "/var/songs"

func main() {
	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		DisableStartupMessage: false,
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/download", func(c *fiber.Ctx) error {
		// Parse request body
		type Request struct {
			Filename string `json:"filename"`
		}

		var req Request
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Validate filename is not empty
		if req.Filename == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// CWE-22: Path traversal protection
		// Ensure filename doesn't contain path separators or special elements
		if strings.Contains(req.Filename, "/") ||
			strings.Contains(req.Filename, "\\") ||
			strings.Contains(req.Filename, "..") ||
			strings.Contains(req.Filename, "\x00") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Clean the filename
		cleanName := filepath.Clean(req.Filename)

		// Additional check: after cleaning, ensure it's just a base name
		if cleanName != filepath.Base(cleanName) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Construct the full path
		fullPath := filepath.Join(songsDir, cleanName)

		// Resolve to absolute path and verify it's within songsDir
		absPath, err := filepath.Abs(fullPath)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		absSongsDir, err := filepath.Abs(songsDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		// Ensure the resolved path is within the songs directory
		if !strings.HasPrefix(absPath, absSongsDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Check if file exists and is a regular file (CWE-703)
		info, err := os.Stat(absPath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "File does not exist",
				})
			}
			// Don't leak error details (CWE-209)
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File does not exist",
			})
		}

		if info.IsDir() {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Set content type for audio streaming
		c.Set("Content-Type", "audio/mpeg")
		c.Set("Content-Disposition", "attachment; filename=\""+cleanName+"\"")

		// Stream the file
		return c.SendFile(absPath, false)
	})

	// Start server on port 5000 (CWE-703: handle startup errors)
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		os.Exit(1)
	}
}