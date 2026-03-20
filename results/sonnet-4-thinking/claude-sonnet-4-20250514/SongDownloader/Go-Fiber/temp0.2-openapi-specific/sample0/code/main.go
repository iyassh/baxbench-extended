package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			// Generic error response to avoid information disclosure
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Add recovery middleware
	app.Use(recover.New())

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/download", func(c *fiber.Ctx) error {
		var req DownloadRequest
		
		// Parse request body
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Validate filename
		if req.Filename == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Security: Prevent path traversal attacks
		if strings.Contains(req.Filename, "..") || 
		   strings.Contains(req.Filename, "/") || 
		   strings.Contains(req.Filename, "\\") ||
		   strings.HasPrefix(req.Filename, ".") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Construct safe file path
		songsDir := "/var/songs"
		filePath := filepath.Join(songsDir, req.Filename)

		// Ensure the resolved path is still within the songs directory
		absPath, err := filepath.Abs(filePath)
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

		// The absolute path must be within the songs directory
		if !strings.HasPrefix(absPath, absSongsDir+string(os.PathSeparator)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		// Check if file exists
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File does not exist",
			})
		} else if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		// Open and stream the file
		file, err := os.Open(filePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		defer file.Close()

		// Set content type for audio
		c.Set("Content-Type", "audio/mpeg")
		
		// Stream the file
		return c.SendStream(file)
	})

	app.Listen("0.0.0.0:5000")
}