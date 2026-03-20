<CODE>
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
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type ImageMetadata struct {
	ID          string
	Filename    string
	ContentType string
}

var (
	imageStore = make(map[string]ImageMetadata)
	storeMutex sync.RWMutex
	uploadDir  = "./uploads"
)

func generateSecureID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func isAllowedImageType(contentType string) bool {
	allowedTypes := map[string]bool{
		"image/jpeg":    true,
		"image/jpg":     true,
		"image/png":     true,
		"image/gif":     true,
		"image/webp":    true,
		"image/bmp":     true,
		"image/svg+xml": true,
		"image/tiff":    true,
		"image/x-icon":  true,
	}
	return allowedTypes[strings.ToLower(contentType)]
}

func sanitizeFilename(filename string) string {
	filename = filepath.Base(filename)
	filename = strings.ReplaceAll(filename, "..", "")
	filename = strings.ReplaceAll(filename, "/", "")
	filename = strings.ReplaceAll(filename, "\\", "")
	return filename
}

func setupSecurityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func main() {
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatal("Failed to create upload directory")
	}

	app := fiber.New(fiber.Config{
		BodyLimit:             10 * 1024 * 1024,
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(recover.New())
	app.Use(setupSecurityHeaders)

	app.Post("/upload", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file upload",
			})
		}

		if file.Size == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file upload",
			})
		}

		if file.Size > 10*1024*1024 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file upload",
			})
		}

		contentType := file.Header.Get("Content-Type")
		if contentType == "" {
			contentType = mime.TypeByExtension(filepath.Ext(file.Filename))
		}

		if !isAllowedImageType(contentType) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file upload",
			})
		}

		imageID, err := generateSecureID()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Upload failed",
			})
		}

		sanitizedFilename := sanitizeFilename(file.Filename)
		if sanitizedFilename == "" {
			sanitizedFilename = "image"
		}

		ext := filepath.Ext(sanitizedFilename)
		storedFilename := imageID + ext

		filePath := filepath.Join(uploadDir, storedFilename)
		cleanPath := filepath.Clean(filePath)
		if !strings.HasPrefix(cleanPath, filepath.Clean(uploadDir)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file upload",
			})
		}

		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Upload failed",
			})
		}
		defer src.Close()

		dst, err := os.Create(cleanPath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Upload failed",
			})
		}
		defer dst.Close()

		written, err := io.Copy(dst, src)
		if err != nil || written == 0 {
			os.Remove(cleanPath)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Upload failed",
			})
		}

		metadata := ImageMetadata{
			ID:          imageID,
			Filename:    storedFilename,
			ContentType: contentType,
		}

		storeMutex.Lock()
		imageStore[imageID] = metadata
		storeMutex.Unlock()

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"id": imageID,
		})
	})

	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		imageID := c.Params("imageId")

		imageID = strings.TrimSpace(imageID)
		if imageID == "" || strings.Contains(imageID, "..") || strings.Contains(imageID, "/") || strings.Contains(imageID, "\\") {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		storeMutex.RLock()
		metadata, exists := imageStore[imageID]
		storeMutex.RUnlock()

		if !exists {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		filePath := filepath.Join(uploadDir, metadata.Filename)
		cleanPath := filepath.Clean(filePath)
		if !strings.HasPrefix(cleanPath, filepath.Clean(uploadDir)) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		if _, err := os.Stat(cleanPath); os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		c.Set("Content-Type", metadata.ContentType)
		c.Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", metadata.Filename))
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("Cache-Control", "public, max-age=31536000")

		return c.SendFile(cleanPath)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>