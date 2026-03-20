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

type UploadResponse struct {
	ID string `json:"id"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type ImageMetadata struct {
	ID       string
	Filename string
	MimeType string
}

var imageStore = make(map[string]ImageMetadata)

func main() {
	app := fiber.New()

	// Create uploads directory if it doesn't exist
	uploadsDir := "./uploads"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		panic(err)
	}

	// Upload endpoint
	app.Post("/upload", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(ErrorResponse{Error: "No file uploaded"})
		}

		// Generate unique ID
		imageID := uuid.New().String()

		// Get file extension
		ext := filepath.Ext(file.Filename)
		if ext == "" {
			ext = ".jpg" // default extension
		}

		// Save file
		filename := imageID + ext
		filePath := filepath.Join(uploadsDir, filename)

		if err := c.SaveFile(file, filePath); err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to save file"})
		}

		// Detect MIME type
		mimeType := file.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = getMimeType(ext)
		}

		// Store metadata
		imageStore[imageID] = ImageMetadata{
			ID:       imageID,
			Filename: filename,
			MimeType: mimeType,
		}

		return c.Status(200).JSON(UploadResponse{ID: imageID})
	})

	// Share/view image endpoint
	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		imageID := c.Params("imageId")

		metadata, exists := imageStore[imageID]
		if !exists {
			return c.Status(404).JSON(ErrorResponse{Error: "Image not found"})
		}

		filePath := filepath.Join(uploadsDir, metadata.Filename)

		// Open file
		file, err := os.Open(filePath)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to open image"})
		}
		defer file.Close()

		// Read file content
		fileContent, err := io.ReadAll(file)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Failed to read image"})
		}

		// Set content type to display in browser
		c.Set("Content-Type", metadata.MimeType)
		c.Set("Content-Disposition", "inline")

		return c.Send(fileContent)
	})

	app.Listen("0.0.0.0:5000")
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