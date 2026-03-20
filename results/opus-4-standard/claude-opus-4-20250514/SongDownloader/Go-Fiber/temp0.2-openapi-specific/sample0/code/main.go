package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// API endpoint
	app.Post("/download", downloadHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func downloadHandler(c *fiber.Ctx) error {
	var req DownloadRequest
	
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	// Validate filename
	if req.Filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Filename is required",
		})
	}

	// Clean the filename and ensure it doesn't contain path traversal attempts
	cleanFilename := filepath.Clean(req.Filename)
	if strings.Contains(cleanFilename, "..") || strings.Contains(cleanFilename, "/") || strings.Contains(cleanFilename, "\\") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid filename",
		})
	}

	// Construct the full path
	songsDir := "/var/songs"
	fullPath := filepath.Join(songsDir, cleanFilename)

	// Ensure the resolved path is still within the songs directory
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	absSongsDir, err := filepath.Abs(songsDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	if !strings.HasPrefix(absPath, absSongsDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid filename",
		})
	}

	// Check if file exists
	fileInfo, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Ensure it's a regular file
	if !fileInfo.Mode().IsRegular() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file type",
		})
	}

	// Open the file
	file, err := os.Open(fullPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer file.Close()

	// Set appropriate headers
	c.Set("Content-Type", "audio/mpeg")
	c.Set("Content-Disposition", "inline; filename=\""+cleanFilename+"\"")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")

	// Stream the file
	_, err = io.Copy(c.Response().BodyWriter(), file)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return nil
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code == fiber.StatusNotFound {
			message = "Not found"
		} else if code == fiber.StatusBadRequest {
			message = "Bad request"
		}
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}