package main

import (
	"fmt"
	"log"
	"net/http"
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
	app := fiber.New(fiber.Config{
		ErrorHandler: secureErrorHandler,
	})

	// Add security headers middleware
	app.Use(securityHeadersMiddleware)

	app.Post("/download", handleDownload)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func secureErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError

	if fe, ok := err.(*fiber.Error); ok {
		code = fe.Code
	}

	// Return generic error message without exposing internal details
	switch code {
	case fiber.StatusNotFound:
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "File does not exist",
		})
	case fiber.StatusBadRequest:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	default:
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
}

func handleDownload(c *fiber.Ctx) error {
	var req DownloadRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if req.Filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Sanitize filename to prevent directory traversal (CWE-22)
	filename := filepath.Base(req.Filename)

	// Construct the full path
	fullPath := filepath.Join(songsDir, filename)

	// Verify the resolved path is within the songs directory
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
	if !strings.HasPrefix(absPath, absSongsDir+string(os.PathSeparator)) && absPath != absSongsDir {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Check if file exists
	fileInfo, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File does not exist",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Ensure it's a file, not a directory
	if fileInfo.IsDir() {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "File does not exist",
		})
	}

	// Set appropriate content type and headers
	c.Set("Content-Type", "audio/mpeg")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

	// Stream the file
	return c.SendFile(absPath)
}