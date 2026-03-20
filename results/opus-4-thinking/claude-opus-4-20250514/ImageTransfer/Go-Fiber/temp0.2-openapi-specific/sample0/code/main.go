package main

import (
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
)

type ImageMetadata struct {
	ID          string
	ContentType string
	FileName    string
}

var (
	imageStore = make(map[string]*ImageMetadata)
	mu         sync.RWMutex
	uploadDir  = "./uploads"
)

func main() {
	// Create upload directory
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		panic(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Recover middleware
	app.Use(recover.New())

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code >= 400 && code < 500 {
			message = "Bad request"
		}
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func uploadHandler(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File upload failed",
		})
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer src.Close()

	// Read first 512 bytes to detect content type
	buffer := make([]byte, 512)
	n, err := src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	
	// Reset file pointer
	if _, err := src.Seek(0, 0); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Detect content type
	contentType := http.DetectContentType(buffer[:n])
	
	// Validate it's an image
	if !strings.HasPrefix(contentType, "image/") {
		// Also check by extension as a fallback
		ext := strings.ToLower(filepath.Ext(file.Filename))
		mimeType := mime.TypeByExtension(ext)
		if !strings.HasPrefix(mimeType, "image/") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File must be an image",
			})
		}
		contentType = mimeType
	}

	// Generate unique ID
	imageID := uuid.New().String()
	
	// Save file
	destPath := filepath.Join(uploadDir, imageID)
	dst, err := os.Create(destPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		os.Remove(destPath)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Store metadata
	mu.Lock()
	imageStore[imageID] = &ImageMetadata{
		ID:          imageID,
		ContentType: contentType,
		FileName:    file.Filename,
	}
	mu.Unlock()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
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
	mu.RLock()
	metadata, exists := imageStore[imageID]
	mu.RUnlock()

	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Read file
	filePath := filepath.Join(uploadDir, imageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Set content type and prevent download
	c.Set("Content-Type", metadata.ContentType)
	c.Set("Content-Disposition", "inline")
	
	return c.Send(data)
}