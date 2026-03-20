package main

import (
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	uploadDir = "./uploads"
	maxFileSize = 10 * 1024 * 1024 // 10MB
)

type ImageMetadata struct {
	ID       string
	Filename string
	MimeType string
}

var imageStore = make(map[string]ImageMetadata)

func main() {
	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		panic(err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
	})

	// Upload endpoint
	app.Post("/upload", func(c *fiber.Ctx) error {
		// Parse multipart form
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "No file uploaded",
			})
		}

		// Validate file size
		if file.Size > maxFileSize {
			return c.Status(400).JSON(fiber.Map{
				"error": "File size exceeds maximum allowed size",
			})
		}

		// Open uploaded file
		src, err := file.Open()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to open uploaded file",
			})
		}
		defer src.Close()

		// Read first 512 bytes to detect content type
		buffer := make([]byte, 512)
		n, err := src.Read(buffer)
		if err != nil && err != io.EOF {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to read file",
			})
		}
		
		// Reset file pointer
		src.Seek(0, 0)

		// Detect MIME type
		mimeType := http.DetectContentType(buffer[:n])
		if !strings.HasPrefix(mimeType, "image/") {
			// Try to detect by extension as fallback
			ext := strings.ToLower(filepath.Ext(file.Filename))
			mimeByExt := mime.TypeByExtension(ext)
			if mimeByExt != "" && strings.HasPrefix(mimeByExt, "image/") {
				mimeType = mimeByExt
			} else if ext == ".svg" {
				mimeType = "image/svg+xml"
			} else if ext == ".webp" {
				mimeType = "image/webp"
			}
		}

		// Generate unique ID
		imageID := uuid.New().String()
		
		// Get file extension
		ext := filepath.Ext(file.Filename)
		if ext == "" {
			// Try to determine extension from MIME type
			exts, _ := mime.ExtensionsByType(mimeType)
			if len(exts) > 0 {
				ext = exts[0]
			}
		}
		
		// Sanitize filename
		filename := imageID + ext
		destPath := filepath.Join(uploadDir, filename)

		// Create destination file
		dst, err := os.Create(destPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save file",
			})
		}
		defer dst.Close()

		// Copy file content
		if _, err = io.Copy(dst, src); err != nil {
			os.Remove(destPath)
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save file",
			})
		}

		// Store metadata
		imageStore[imageID] = ImageMetadata{
			ID:       imageID,
			Filename: filename,
			MimeType: mimeType,
		}

		return c.Status(200).JSON(fiber.Map{
			"id": imageID,
		})
	})

	// Share/view endpoint
	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		imageID := c.Params("imageId")
		
		// Validate image ID format
		if imageID == "" || len(imageID) > 100 {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		// Get image metadata
		metadata, exists := imageStore[imageID]
		if !exists {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		// Construct file path
		filePath := filepath.Join(uploadDir, metadata.Filename)
		
		// Check if file exists
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			delete(imageStore, imageID)
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		// Set content type to display in browser
		c.Set("Content-Type", metadata.MimeType)
		c.Set("Cache-Control", "public, max-age=3600")
		
		// Send file (inline display, not download)
		return c.SendFile(filePath)
	})

	// Start server
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}