package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

const (
	maxFileSize = 10 * 1024 * 1024 // 10MB
	uploadDir   = "./uploads"
)

var allowedMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/jpg":  true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
	"image/svg+xml": true,
}

type ImageMetadata struct {
	ID       string
	MimeType string
	Filename string
}

var imageStore = make(map[string]*ImageMetadata)

func main() {
	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatal("Failed to create upload directory:", err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit:             maxFileSize,
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred processing your request",
			})
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		return c.Next()
	})

	// Upload endpoint
	app.Post("/upload", handleUpload)

	// Image viewing endpoint
	app.Get("/images/:imageId", handleGetImage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleUpload(c *fiber.Ctx) error {
	// Parse multipart form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file upload",
		})
	}

	// Validate file size
	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File size exceeds limit",
		})
	}

	// Open uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process upload",
		})
	}
	defer src.Close()

	// Read first 512 bytes to detect content type
	buffer := make([]byte, 512)
	n, err := src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process upload",
		})
	}
	
	// Reset file pointer
	if _, err := src.Seek(0, 0); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process upload",
		})
	}

	// Detect MIME type
	mimeType := http.DetectContentType(buffer[:n])
	
	// Validate MIME type
	if !allowedMimeTypes[mimeType] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file type",
		})
	}

	// Generate unique ID
	imageID := generateID()
	
	// Get file extension from MIME type
	exts, err := mime.ExtensionsByType(mimeType)
	ext := ".jpg" // default
	if err == nil && len(exts) > 0 {
		ext = exts[0]
	}

	// Create safe filename
	filename := imageID + ext
	filePath := filepath.Join(uploadDir, filename)

	// Ensure path doesn't escape upload directory
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process upload",
		})
	}
	
	absUploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process upload",
		})
	}

	if !strings.HasPrefix(absPath, absUploadDir) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file path",
		})
	}

	// Create destination file
	dst, err := os.Create(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save upload",
		})
	}
	defer dst.Close()

	// Copy file content
	if _, err := io.Copy(dst, src); err != nil {
		os.Remove(filePath)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to save upload",
		})
	}

	// Store metadata
	imageStore[imageID] = &ImageMetadata{
		ID:       imageID,
		MimeType: mimeType,
		Filename: filename,
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": imageID,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")
	
	// Validate image ID format (alphanumeric only)
	if !isValidID(imageID) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Get image metadata
	metadata, exists := imageStore[imageID]
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Construct file path
	filePath := filepath.Join(uploadDir, metadata.Filename)
	
	// Ensure path doesn't escape upload directory
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image",
		})
	}
	
	absUploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image",
		})
	}

	if !strings.HasPrefix(absPath, absUploadDir) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		delete(imageStore, imageID)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Set content type and disposition to display in browser
	c.Set("Content-Type", metadata.MimeType)
	c.Set("Content-Disposition", "inline")
	c.Set("Cache-Control", "public, max-age=3600")
	
	// Send file
	return c.SendFile(filePath)
}

func generateID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	return hex.EncodeToString(bytes)
}

func isValidID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for _, c := range id {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}