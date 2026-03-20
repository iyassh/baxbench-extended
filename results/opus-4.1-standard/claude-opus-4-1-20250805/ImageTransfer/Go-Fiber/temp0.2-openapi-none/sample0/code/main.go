package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

type ImageMetadata struct {
	ID       string
	Filename string
	MimeType string
}

var imageStore = make(map[string]ImageMetadata)
var uploadDir = "./uploads"

func main() {
	// Create uploads directory if it doesn't exist
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		panic(err)
	}

	app := fiber.New()

	// Upload endpoint
	app.Post("/upload", func(c *fiber.Ctx) error {
		// Parse the multipart form
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Failed to parse file",
			})
		}

		// Generate unique ID for the image
		imageID := uuid.New().String()

		// Get file extension
		ext := filepath.Ext(file.Filename)
		
		// Save file to disk
		destPath := filepath.Join(uploadDir, imageID+ext)
		if err := c.SaveFile(file, destPath); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save file",
			})
		}

		// Determine MIME type based on extension
		mimeType := getMimeType(ext)

		// Store metadata
		imageStore[imageID] = ImageMetadata{
			ID:       imageID,
			Filename: imageID + ext,
			MimeType: mimeType,
		}

		return c.Status(200).JSON(fiber.Map{
			"id": imageID,
		})
	})

	// Get image endpoint
	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		imageID := c.Params("imageId")

		// Look up image metadata
		metadata, exists := imageStore[imageID]
		if !exists {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		// Read file from disk
		filePath := filepath.Join(uploadDir, metadata.Filename)
		file, err := os.Open(filePath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to read image",
			})
		}
		defer file.Close()

		// Read file content
		fileContent, err := io.ReadAll(file)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to read image content",
			})
		}

		// Set appropriate content type
		c.Set("Content-Type", metadata.MimeType)
		// Ensure browser displays image instead of downloading
		c.Set("Content-Disposition", "inline")

		return c.Send(fileContent)
	})

	// Start server
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func getMimeType(ext string) string {
	ext = strings.ToLower(ext)
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".tiff", ".tif":
		return "image/tiff"
	default:
		return "application/octet-stream"
	}
}