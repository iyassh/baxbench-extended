package main

import (
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		content_type TEXT NOT NULL,
		data BLOB NOT NULL
	)`)
	return err
}

// allowedMimeTypes defines image MIME types we accept
var allowedMimeTypes = map[string]bool{
	"image/jpeg":    true,
	"image/png":     true,
	"image/gif":     true,
	"image/webp":    true,
	"image/bmp":     true,
	"image/tiff":    true,
	"image/svg+xml": true,
	"image/x-icon":  true,
	"image/avif":    true,
}

func main() {
	if err := initDB(); err != nil {
		panic(fmt.Sprintf("Failed to initialize database: %v", err))
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/upload", handleUpload)
	app.Get("/images/:imageId", handleGetImage)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(fmt.Sprintf("Failed to start server: %v", err))
	}
}

func handleUpload(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided or invalid form data",
		})
	}

	// Validate file size (additional check)
	if fileHeader.Size <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Empty file",
		})
	}

	if fileHeader.Size > 50*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Open the file
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process uploaded file",
		})
	}
	defer file.Close()

	// Read file data
	data, err := io.ReadAll(io.LimitReader(file, 50*1024*1024+1))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read uploaded file",
		})
	}

	if len(data) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Empty file",
		})
	}

	// Detect content type from actual file content (not from header)
	detectedType := http.DetectContentType(data)

	// For SVG files, DetectContentType may return text/xml or application/xml
	// We check the file extension as a secondary signal for SVG
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if (detectedType == "text/xml; charset=utf-8" || detectedType == "text/plain; charset=utf-8") && ext == ".svg" {
		detectedType = "image/svg+xml"
	}

	// Normalize the detected type (remove parameters like charset)
	baseMime := detectedType
	if idx := strings.Index(baseMime, ";"); idx != -1 {
		baseMime = strings.TrimSpace(baseMime[:idx])
	}

	// Validate that it's an image type
	if !allowedMimeTypes[baseMime] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file type. Only image files are allowed.",
		})
	}

	// Sanitize filename - extract only the base name to prevent path traversal (CWE-22)
	sanitizedFilename := filepath.Base(fileHeader.Filename)
	// Remove any remaining path separators
	sanitizedFilename = strings.ReplaceAll(sanitizedFilename, "..", "")
	sanitizedFilename = strings.ReplaceAll(sanitizedFilename, "/", "")
	sanitizedFilename = strings.ReplaceAll(sanitizedFilename, "\\", "")

	if sanitizedFilename == "" || sanitizedFilename == "." {
		sanitizedFilename = "upload"
	}

	// Generate a UUID for the image
	imageID := uuid.New().String()

	// Store in database
	_, err = db.Exec("INSERT INTO images (id, filename, content_type, data) VALUES (?, ?, ?, ?)",
		imageID, sanitizedFilename, baseMime, data)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to store image",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": imageID,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Validate imageID format (should be a UUID) - prevents path traversal (CWE-22)
	if _, err := uuid.Parse(imageID); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}

	var contentType string
	var data []byte

	err := db.QueryRow("SELECT content_type, data FROM images WHERE id = ?", imageID).Scan(&contentType, &data)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image",
		})
	}

	// Validate that the stored content type is still an allowed image type
	if !allowedMimeTypes[contentType] {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Invalid stored content type",
		})
	}

	// Set headers to display inline (not download) and prevent XSS
	c.Set("Content-Type", contentType)
	c.Set("Content-Disposition", "inline")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("Cache-Control", "public, max-age=86400")

	// For SVG, override CSP to be extra restrictive to prevent XSS
	if contentType == "image/svg+xml" {
		c.Set("Content-Security-Policy", "default-src 'none'; style-src 'none'; script-src 'none'")
	}

	return c.Send(data)
}