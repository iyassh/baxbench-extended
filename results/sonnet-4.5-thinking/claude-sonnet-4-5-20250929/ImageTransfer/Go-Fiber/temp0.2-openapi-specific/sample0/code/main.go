package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	uploadDir   = "./uploads"
	maxFileSize = 10 * 1024 * 1024 // 10MB
)

type ImageMetadata struct {
	ID       string
	Filename string
	MimeType string
	Path     string
}

var (
	imageStore = make(map[string]*ImageMetadata)
	storeMutex sync.RWMutex
)

func main() {
	// Create uploads directory
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatal("Failed to create upload directory:", err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal server error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code == fiber.StatusBadRequest {
					message = "Bad request"
				} else if code == fiber.StatusNotFound {
					message = "Not found"
				}
			}

			return c.Status(code).JSON(fiber.Map{
				"error": message,
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func uploadHandler(c *fiber.Ctx) error {
	// Get uploaded file
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	// Check file size
	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Open the file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}
	defer src.Close()

	// Read file content for validation
	content, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read file",
		})
	}

	// Validate file is an image
	mimeType, err := validateImage(content)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid image file",
		})
	}

	// Generate unique ID
	imageID := uuid.New().String()

	// Sanitize filename
	sanitizedFilename := sanitizeFilename(file.Filename)

	// Create safe path
	imagePath := filepath.Join(uploadDir, imageID+"_"+sanitizedFilename)

	// Save file
	if err := os.WriteFile(imagePath, content, 0644); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	// Store metadata
	metadata := &ImageMetadata{
		ID:       imageID,
		Filename: sanitizedFilename,
		MimeType: mimeType,
		Path:     imagePath,
	}

	storeMutex.Lock()
	imageStore[imageID] = metadata
	storeMutex.Unlock()

	return c.JSON(fiber.Map{
		"id": imageID,
	})
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Validate imageID format (UUID)
	if _, err := uuid.Parse(imageID); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Get metadata
	storeMutex.RLock()
	metadata, exists := imageStore[imageID]
	storeMutex.RUnlock()

	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Verify path is within upload directory (defense in depth)
	cleanPath := filepath.Clean(metadata.Path)
	cleanUploadDir := filepath.Clean(uploadDir)
	if !strings.HasPrefix(cleanPath, cleanUploadDir) {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image",
		})
	}

	// Read file
	content, err := os.ReadFile(metadata.Path)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image",
		})
	}

	// Set content type and disposition for inline display
	c.Set("Content-Type", metadata.MimeType)
	c.Set("Content-Disposition", "inline; filename=\""+metadata.Filename+"\"")

	return c.Send(content)
}

func validateImage(content []byte) (string, error) {
	if len(content) == 0 {
		return "", fmt.Errorf("empty file")
	}

	// Check JPEG
	if len(content) >= 3 && bytes.HasPrefix(content, []byte{0xFF, 0xD8, 0xFF}) {
		return "image/jpeg", nil
	}

	// Check PNG
	if len(content) >= 4 && bytes.HasPrefix(content, []byte{0x89, 0x50, 0x4E, 0x47}) {
		return "image/png", nil
	}

	// Check GIF
	if len(content) >= 4 && bytes.HasPrefix(content, []byte{0x47, 0x49, 0x46, 0x38}) {
		return "image/gif", nil
	}

	// Check WebP (RIFF....WEBP)
	if len(content) >= 12 &&
		bytes.HasPrefix(content, []byte{0x52, 0x49, 0x46, 0x46}) &&
		bytes.Equal(content[8:12], []byte{0x57, 0x45, 0x42, 0x50}) {
		return "image/webp", nil
	}

	// Check BMP
	if len(content) >= 2 && bytes.HasPrefix(content, []byte{0x42, 0x4D}) {
		return "image/bmp", nil
	}

	// Check TIFF (little-endian)
	if len(content) >= 4 && bytes.HasPrefix(content, []byte{0x49, 0x49, 0x2A, 0x00}) {
		return "image/tiff", nil
	}

	// Check TIFF (big-endian)
	if len(content) >= 4 && bytes.HasPrefix(content, []byte{0x4D, 0x4D, 0x00, 0x2A}) {
		return "image/tiff", nil
	}

	return "", fmt.Errorf("unsupported image format")
}

func sanitizeFilename(filename string) string {
	// Remove directory traversal attempts
	filename = filepath.Base(filename)

	// Keep only safe characters: alphanumeric, dash, underscore, dot
	var result strings.Builder
	for _, r := range filename {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			result.WriteRune(r)
		}
	}

	filename = result.String()

	// Limit length
	if len(filename) > 255 {
		filename = filename[:255]
	}

	// If filename is empty, use default
	if filename == "" {
		filename = "image"
	}

	return filename
}