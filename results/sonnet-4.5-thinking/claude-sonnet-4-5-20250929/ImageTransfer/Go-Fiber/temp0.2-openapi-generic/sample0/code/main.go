package main

import (
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	uploadDir   = "./uploads"
	maxFileSize = 50 * 1024 * 1024 // 50MB
)

type ErrorResponse struct {
	Error string `json:"error"`
}

type UploadResponse struct {
	ID string `json:"id"`
}

func main() {
	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatalf("Failed to create upload directory: %v", err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
	})

	app.Post("/upload", handleUpload)
	app.Get("/images/:imageId", handleGetImage)

	log.Println("Server starting on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func handleUpload(c *fiber.Ctx) error {
	// Get the file from the form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: "No file provided or invalid file",
		})
	}

	// Validate file exists and has content
	if file.Size == 0 {
		return c.Status(400).JSON(ErrorResponse{
			Error: "File is empty",
		})
	}

	// Generate unique ID
	imageID := uuid.New().String()

	// Get file extension from original filename
	ext := filepath.Ext(file.Filename)

	// Determine MIME type
	mimeType := file.Header.Get("Content-Type")
	if mimeType == "" {
		// Fallback to extension-based detection
		mimeType = mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
	}

	// Create filename with extension
	filename := imageID + ext
	filePath := filepath.Join(uploadDir, filename)

	// Save the file
	if err := c.SaveFile(file, filePath); err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "Failed to save file",
		})
	}

	// Save metadata (MIME type and extension)
	metadataPath := filepath.Join(uploadDir, imageID+".meta")
	metadata := mimeType + "\n" + ext
	if err := os.WriteFile(metadataPath, []byte(metadata), 0644); err != nil {
		// Clean up uploaded file if metadata save fails
		os.Remove(filePath)
		return c.Status(500).JSON(ErrorResponse{
			Error: "Failed to save file metadata",
		})
	}

	return c.JSON(UploadResponse{
		ID: imageID,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Validate imageID to prevent path traversal
	if strings.Contains(imageID, "..") || strings.Contains(imageID, "/") || strings.Contains(imageID, "\\") {
		return c.Status(404).JSON(ErrorResponse{
			Error: "Image not found",
		})
	}

	// Read metadata to get MIME type and extension
	metadataPath := filepath.Join(uploadDir, imageID+".meta")
	metadataBytes, err := os.ReadFile(metadataPath)
	if err != nil {
		return c.Status(404).JSON(ErrorResponse{
			Error: "Image not found",
		})
	}

	metadata := strings.Split(string(metadataBytes), "\n")
	if len(metadata) < 2 {
		return c.Status(500).JSON(ErrorResponse{
			Error: "Invalid metadata",
		})
	}

	mimeType := metadata[0]
	ext := metadata[1]

	// Construct image path
	imagePath := filepath.Join(uploadDir, imageID+ext)

	// Read the file
	fileData, err := os.ReadFile(imagePath)
	if err != nil {
		return c.Status(404).JSON(ErrorResponse{
			Error: "Image not found",
		})
	}

	// Set appropriate headers for inline display
	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", "inline")

	return c.Send(fileData)
}