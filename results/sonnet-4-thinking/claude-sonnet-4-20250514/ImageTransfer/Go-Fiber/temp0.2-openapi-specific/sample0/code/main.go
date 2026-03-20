package main

import (
	"database/sql"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Image struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	MimeType string `json:"mime_type"`
	FilePath string `json:"file_path"`
}

var db *sql.DB

func main() {
	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}
	defer db.Close()

	// Create images table
	_, err = db.Exec(`
		CREATE TABLE images (
			id TEXT PRIMARY KEY,
			filename TEXT NOT NULL,
			mime_type TEXT NOT NULL,
			file_path TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}

	// Create uploads directory
	err = os.MkdirAll("uploads", 0755)
	if err != nil {
		log.Fatal("Failed to create uploads directory:", err)
	}

	// Initialize Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Middleware
	app.Use(recover.New())
	app.Use(cors.New())

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; script-src 'none'; object-src 'none'")
		return c.Next()
	})

	// Routes
	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", getImage)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func uploadImage(c *fiber.Ctx) error {
	// Get file from multipart form
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	// Validate file type by extension
	if !isValidImageType(file.Filename) {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid file type",
		})
	}

	// Open uploaded file to check content type
	src, err := file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}

	// Read first 512 bytes to detect content type
	buffer := make([]byte, 512)
	n, err := src.Read(buffer)
	if err != nil && err != io.EOF {
		src.Close()
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}
	src.Close()

	// Detect MIME type
	mimeType := http.DetectContentType(buffer[:n])
	if !isValidImageMimeType(mimeType) {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid file type",
		})
	}

	// Reopen file for copying
	src, err = file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to process file",
		})
	}
	defer src.Close()

	// Generate unique ID and file path
	imageID := uuid.New().String()
	ext := filepath.Ext(file.Filename)
	fileName := imageID + ext
	filePath := filepath.Join("uploads", fileName)

	// Save file
	dst, err := os.Create(filePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	if err != nil {
		os.Remove(filePath) // Clean up on failure
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	// Save metadata to database
	_, err = db.Exec(`
		INSERT INTO images (id, filename, mime_type, file_path)
		VALUES (?, ?, ?, ?)
	`, imageID, file.Filename, mimeType, filePath)
	if err != nil {
		os.Remove(filePath) // Clean up on failure
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save metadata",
		})
	}

	return c.JSON(fiber.Map{
		"id": imageID,
	})
}

func getImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Validate UUID format to prevent injection
	_, err := uuid.Parse(imageID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Get image metadata from database
	var image Image
	err = db.QueryRow(`
		SELECT id, filename, mime_type, file_path
		FROM images
		WHERE id = ?
	`, imageID).Scan(&image.ID, &image.Filename, &image.MimeType, &image.FilePath)

	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	// Check if file exists
	if _, err := os.Stat(image.FilePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Set appropriate headers for image viewing
	c.Set("Content-Type", image.MimeType)
	c.Set("Content-Disposition", "inline") // Display in browser, not download

	// Send file
	return c.SendFile(image.FilePath)
}

func isValidImageType(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	validExts := []string{".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg"}

	for _, validExt := range validExts {
		if ext == validExt {
			return true
		}
	}
	return false
}

func isValidImageMimeType(mimeType string) bool {
	validTypes := []string{
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
		"image/bmp",
		"image/tiff",
		"image/svg+xml",
	}

	for _, validType := range validTypes {
		if mimeType == validType {
			return true
		}
	}
	return false
}