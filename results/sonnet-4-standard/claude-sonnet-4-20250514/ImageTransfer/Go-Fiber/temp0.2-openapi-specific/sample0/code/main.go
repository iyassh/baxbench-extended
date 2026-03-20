package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	_ "github.com/mattn/go-sqlite3"
)

type ImageRecord struct {
	ID       string
	Filename string
	MimeType string
	FilePath string
}

var db *sql.DB

func main() {
	var err error
	
	// Initialize database
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

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	// Security middleware
	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", getImage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func uploadImage(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	if file == nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	// Validate file size
	if file.Size > 10*1024*1024 {
		return c.Status(400).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Open the uploaded file
	src, err := file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer src.Close()

	// Read first 512 bytes to detect content type
	buffer := make([]byte, 512)
	n, err := src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Reset file pointer
	src.Close()
	src, err = file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer src.Close()

	// Detect MIME type
	mimeType := mime.TypeByExtension(filepath.Ext(file.Filename))
	if mimeType == "" {
		// Fallback to content detection
		detectedType := detectContentType(buffer[:n])
		if detectedType == "" {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid file type",
			})
		}
		mimeType = detectedType
	}

	// Validate that it's an image
	if !strings.HasPrefix(mimeType, "image/") {
		return c.Status(400).JSON(fiber.Map{
			"error": "File must be an image",
		})
	}

	// Generate secure random ID
	imageID, err := generateSecureID()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Sanitize filename and create safe file path
	ext := filepath.Ext(file.Filename)
	if ext == "" {
		// Try to get extension from MIME type
		exts, _ := mime.ExtensionsByType(mimeType)
		if len(exts) > 0 {
			ext = exts[0]
		} else {
			ext = ".bin"
		}
	}
	
	safeFilename := imageID + ext
	filePath := filepath.Join("uploads", safeFilename)

	// Ensure the file path is within uploads directory
	absPath, err := filepath.Abs(filePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	
	uploadsDir, err := filepath.Abs("uploads")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	
	if !strings.HasPrefix(absPath, uploadsDir) {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid file path",
		})
	}

	// Save file
	dst, err := os.Create(filePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	if err != nil {
		os.Remove(filePath)
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Store in database
	_, err = db.Exec(
		"INSERT INTO images (id, filename, mime_type, file_path) VALUES (?, ?, ?, ?)",
		imageID, file.Filename, mimeType, filePath,
	)
	if err != nil {
		os.Remove(filePath)
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"id": imageID,
	})
}

func getImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")
	
	// Validate imageID format (should be hex string)
	if len(imageID) != 32 {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	
	for _, char := range imageID {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
	}

	var image ImageRecord
	err := db.QueryRow(
		"SELECT id, filename, mime_type, file_path FROM images WHERE id = ?",
		imageID,
	).Scan(&image.ID, &image.Filename, &image.MimeType, &image.FilePath)
	
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Verify file path is safe
	absPath, err := filepath.Abs(image.FilePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	
	uploadsDir, err := filepath.Abs("uploads")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	
	if !strings.HasPrefix(absPath, uploadsDir) {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Check if file exists
	if _, err := os.Stat(image.FilePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	// Set appropriate headers for browser viewing
	c.Set("Content-Type", image.MimeType)
	c.Set("Content-Disposition", "inline")
	c.Set("Cache-Control", "public, max-age=3600")

	return c.SendFile(image.FilePath)
}

func generateSecureID() (string, error) {
	bytes := make([]byte, 16)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func detectContentType(data []byte) string {
	// Basic image type detection
	if len(data) < 4 {
		return ""
	}

	// JPEG
	if len(data) >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
		return "image/jpeg"
	}

	// PNG
	if len(data) >= 8 && 
		data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 &&
		data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A {
		return "image/png"
	}

	// GIF
	if len(data) >= 6 && 
		((data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 && data[4] == 0x37 && data[5] == 0x61) ||
		 (data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38 && data[4] == 0x39 && data[5] == 0x61)) {
		return "image/gif"
	}

	// WebP
	if len(data) >= 12 && 
		data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 &&
		data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50 {
		return "image/webp"
	}

	// BMP
	if len(data) >= 2 && data[0] == 0x42 && data[1] == 0x4D {
		return "image/bmp"
	}

	return ""
}