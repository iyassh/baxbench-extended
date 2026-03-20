package main

import (
	"fmt"
	"io"
	"log"
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

type ImageInfo struct {
	ID       string
	Filename string
	MimeType string
}

var imageStore = make(map[string]ImageInfo)

func main() {
	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatal("Failed to create upload directory:", err)
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
		mimeType := detectMimeType(buffer[:n], file.Filename)
		if !isImageMimeType(mimeType) {
			return c.Status(400).JSON(fiber.Map{
				"error": "File is not a valid image",
			})
		}

		// Generate unique ID
		imageID := uuid.New().String()

		// Get file extension
		ext := filepath.Ext(file.Filename)
		if ext == "" {
			ext = getExtensionFromMimeType(mimeType)
		}

		// Create destination filename
		destFilename := imageID + ext
		destPath := filepath.Join(uploadDir, destFilename)

		// Create destination file
		dst, err := os.Create(destPath)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save file",
			})
		}
		defer dst.Close()

		// Copy file content
		if _, err := io.Copy(dst, src); err != nil {
			os.Remove(destPath)
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save file",
			})
		}

		// Store image info
		imageStore[imageID] = ImageInfo{
			ID:       imageID,
			Filename: destFilename,
			MimeType: mimeType,
		}

		return c.JSON(fiber.Map{
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

		// Look up image info
		imageInfo, exists := imageStore[imageID]
		if !exists {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		// Construct file path
		filePath := filepath.Join(uploadDir, imageInfo.Filename)

		// Check if file exists
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			delete(imageStore, imageID)
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		// Set appropriate headers for browser viewing
		c.Set("Content-Type", imageInfo.MimeType)
		c.Set("Cache-Control", "public, max-age=3600")
		
		// Send file
		return c.SendFile(filePath)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func detectMimeType(buffer []byte, filename string) string {
	// Check magic numbers for common image formats
	if len(buffer) >= 2 {
		if buffer[0] == 0xFF && buffer[1] == 0xD8 {
			return "image/jpeg"
		}
		if buffer[0] == 0x89 && len(buffer) >= 8 &&
			buffer[1] == 0x50 && buffer[2] == 0x4E && buffer[3] == 0x47 &&
			buffer[4] == 0x0D && buffer[5] == 0x0A && buffer[6] == 0x1A && buffer[7] == 0x0A {
			return "image/png"
		}
		if buffer[0] == 0x47 && buffer[1] == 0x49 && len(buffer) >= 6 {
			return "image/gif"
		}
		if buffer[0] == 0x42 && buffer[1] == 0x4D {
			return "image/bmp"
		}
	}
	
	if len(buffer) >= 4 {
		if buffer[0] == 0x52 && buffer[1] == 0x49 && buffer[2] == 0x46 && buffer[3] == 0x46 {
			if len(buffer) >= 12 && buffer[8] == 0x57 && buffer[9] == 0x45 && buffer[10] == 0x42 && buffer[11] == 0x50 {
				return "image/webp"
			}
		}
	}

	// Fallback to extension-based detection
	ext := strings.ToLower(filepath.Ext(filename))
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

func isImageMimeType(mimeType string) bool {
	return strings.HasPrefix(mimeType, "image/")
}

func getExtensionFromMimeType(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/bmp":
		return ".bmp"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	case "image/x-icon":
		return ".ico"
	case "image/tiff":
		return ".tiff"
	default:
		return ".bin"
	}
}