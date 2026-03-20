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
	uploadDir     = "./uploads"
	maxFileSize   = 10 * 1024 * 1024 // 10MB
	allowedImages = ".jpg,.jpeg,.png,.gif,.bmp,.webp,.svg"
)

type UploadResponse struct {
	ID string `json:"id"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type ImageMetadata struct {
	ID          string
	OriginalExt string
	MimeType    string
}

var imageStore = make(map[string]ImageMetadata)

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
			return c.Status(code).JSON(ErrorResponse{Error: "Internal server error"})
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

	// Routes
	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func uploadHandler(c *fiber.Ctx) error {
	// Parse multipart form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid file upload"})
	}

	// Validate file size
	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "File too large"})
	}

	// Open uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to process file"})
	}
	defer src.Close()

	// Read first 512 bytes to detect content type
	buffer := make([]byte, 512)
	n, err := src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to process file"})
	}
	
	// Reset file pointer
	src.Seek(0, 0)

	// Detect MIME type
	mimeType := http.DetectContentType(buffer[:n])
	
	// Validate that it's an image
	if !strings.HasPrefix(mimeType, "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "File must be an image"})
	}

	// Get file extension from MIME type
	exts, _ := mime.ExtensionsByType(mimeType)
	ext := ".jpg" // default
	if len(exts) > 0 {
		ext = exts[0]
	}

	// Validate extension
	if !isAllowedExtension(ext) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid file type"})
	}

	// Generate unique ID
	imageID := generateID()
	
	// Create safe filename
	filename := imageID + ext
	destPath := filepath.Join(uploadDir, filename)

	// Ensure the path is within upload directory
	absPath, err := filepath.Abs(destPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to process file"})
	}
	
	absUploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to process file"})
	}
	
	if !strings.HasPrefix(absPath, absUploadDir) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid file path"})
	}

	// Create destination file
	dst, err := os.Create(destPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to save file"})
	}
	defer dst.Close()

	// Copy file content
	if _, err = io.Copy(dst, src); err != nil {
		os.Remove(destPath)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to save file"})
	}

	// Store metadata
	imageStore[imageID] = ImageMetadata{
		ID:          imageID,
		OriginalExt: ext,
		MimeType:    mimeType,
	}

	return c.Status(fiber.StatusOK).JSON(UploadResponse{ID: imageID})
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")
	
	// Validate image ID format
	if !isValidID(imageID) {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "Image not found"})
	}

	// Get image metadata
	metadata, exists := imageStore[imageID]
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "Image not found"})
	}

	// Construct file path
	filename := metadata.ID + metadata.OriginalExt
	filePath := filepath.Join(uploadDir, filename)

	// Ensure the path is within upload directory
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to retrieve image"})
	}
	
	absUploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to retrieve image"})
	}
	
	if !strings.HasPrefix(absPath, absUploadDir) {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "Image not found"})
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		delete(imageStore, imageID)
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "Image not found"})
	}

	// Set appropriate headers
	c.Set("Content-Type", metadata.MimeType)
	c.Set("Cache-Control", "public, max-age=3600")
	c.Set("Content-Disposition", "inline")

	// Send file
	return c.SendFile(filePath)
}

func generateID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
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

func isAllowedExtension(ext string) bool {
	ext = strings.ToLower(ext)
	allowed := strings.Split(allowedImages, ",")
	for _, a := range allowed {
		if ext == a {
			return true
		}
	}
	return false
}