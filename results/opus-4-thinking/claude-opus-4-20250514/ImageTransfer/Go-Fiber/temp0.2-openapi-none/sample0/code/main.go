package main

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

var uploadDir = "./uploads"

func main() {
	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		panic(err)
	}

	app := fiber.New()

	// Upload endpoint
	app.Post("/upload", uploadHandler)

	// Image viewing endpoint
	app.Get("/images/:imageId", getImageHandler)

	// Start server
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}

func uploadHandler(c *fiber.Ctx) error {
	// Parse multipart form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Failed to parse file from request",
		})
	}

	// Generate unique ID
	id := uuid.New().String()

	// Save file
	filePath := filepath.Join(uploadDir, id)
	if err := c.SaveFile(file, filePath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	return c.JSON(fiber.Map{
		"id": id,
	})
}

func getImageHandler(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	// Build file path
	filePath := filepath.Join(uploadDir, imageId)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Open file to detect content type
	file, err := os.Open(filePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to open image file",
		})
	}
	defer file.Close()

	// Read first 512 bytes for content type detection
	buffer := make([]byte, 512)
	n, _ := file.Read(buffer)
	contentType := http.DetectContentType(buffer[:n])

	// Set headers to display in browser
	c.Set("Content-Type", contentType)
	c.Set("Content-Disposition", "inline")

	// Send file
	return c.SendFile(filePath)
}