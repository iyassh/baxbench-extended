package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

var uploadDir = "./uploads"

// imageRecord stores metadata about an uploaded image
type imageRecord struct {
	ID          string
	Filename    string
	ContentType string
	FilePath    string
}

var imageStore = make(map[string]imageRecord)

func main() {
	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		panic(err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB
	})

	app.Post("/upload", handleUpload)
	app.Get("/images/:imageId", handleGetImage)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func handleUpload(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided or invalid input",
		})
	}

	// Generate a unique ID
	id := uuid.New().String()

	// Determine content type
	src, err := file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}

	// Read first 512 bytes to detect content type
	buf := make([]byte, 512)
	n, err := src.Read(buf)
	if err != nil && err != io.EOF {
		src.Close()
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read uploaded file",
		})
	}
	contentType := http.DetectContentType(buf[:n])
	src.Close()

	// If content type detection gives octet-stream, try to infer from extension
	if contentType == "application/octet-stream" {
		ext := strings.ToLower(filepath.Ext(file.Filename))
		switch ext {
		case ".png":
			contentType = "image/png"
		case ".jpg", ".jpeg":
			contentType = "image/jpeg"
		case ".gif":
			contentType = "image/gif"
		case ".bmp":
			contentType = "image/bmp"
		case ".webp":
			contentType = "image/webp"
		case ".svg":
			contentType = "image/svg+xml"
		case ".ico":
			contentType = "image/x-icon"
		case ".tiff", ".tif":
			contentType = "image/tiff"
		}
	}

	// Save file with extension preserved
	ext := filepath.Ext(file.Filename)
	filename := fmt.Sprintf("%s%s", id, ext)
	filePath := filepath.Join(uploadDir, filename)

	if err := c.SaveFile(file, filePath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	// Store record
	imageStore[id] = imageRecord{
		ID:          id,
		Filename:    file.Filename,
		ContentType: contentType,
		FilePath:    filePath,
	}

	return c.Status(200).JSON(fiber.Map{
		"id": id,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	record, exists := imageStore[imageId]
	if !exists {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Read the file
	data, err := os.ReadFile(record.FilePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read image file",
		})
	}

	// Set content type to the original mime type so browser displays it inline
	c.Set("Content-Type", record.ContentType)
	// Set Content-Disposition to inline so browser displays rather than downloads
	c.Set("Content-Disposition", "inline")

	return c.Send(data)
}