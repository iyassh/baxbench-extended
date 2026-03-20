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

// allowedContentTypes defines the image MIME types we accept
var allowedContentTypes = map[string]bool{
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
		panic(err)
	}
}

func handleUpload(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided or invalid form data.",
		})
	}

	// Validate file size (additional check)
	if fileHeader.Size <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Empty file.",
		})
	}

	if fileHeader.Size > 50*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large.",
		})
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process uploaded file.",
		})
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, 50*1024*1024+1))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read uploaded file.",
		})
	}

	if len(data) > 50*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large.",
		})
	}

	// Detect content type from file content (not from header, to prevent spoofing)
	detectedType := http.DetectContentType(data)

	// For SVG, DetectContentType returns text/xml or application/xml, so also check extension
	isSVG := false
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if ext == ".svg" && (strings.HasPrefix(detectedType, "text/xml") || strings.HasPrefix(detectedType, "text/plain") || strings.HasPrefix(detectedType, "application/xml")) {
		// SVG files are risky due to XSS, but the spec says accept all formats
		// We'll serve them with a safe CSP and as image/svg+xml
		isSVG = true
	}

	// Validate that the detected content type is an image
	if !isSVG && !allowedContentTypes[detectedType] {
		// Check if it starts with "image/"
		if !strings.HasPrefix(detectedType, "image/") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Uploaded file is not a valid image.",
			})
		}
	}

	contentType := detectedType
	if isSVG {
		contentType = "image/svg+xml"
	}

	// Sanitize filename - only keep the base name and remove path traversal
	sanitizedFilename := filepath.Base(fileHeader.Filename)
	// Remove any remaining suspicious characters
	sanitizedFilename = strings.ReplaceAll(sanitizedFilename, "..", "")
	sanitizedFilename = strings.ReplaceAll(sanitizedFilename, "/", "")
	sanitizedFilename = strings.ReplaceAll(sanitizedFilename, "\\", "")

	id := uuid.New().String()

	_, err = db.Exec("INSERT INTO images (id, filename, content_type, data) VALUES (?, ?, ?, ?)",
		id, sanitizedFilename, contentType, data)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to store image.",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": id,
	})
}

func handleGetImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	// Validate imageId is a valid UUID to prevent injection
	if _, err := uuid.Parse(imageId); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found.",
		})
	}

	var filename string
	var contentType string
	var data []byte

	err := db.QueryRow("SELECT filename, content_type, data FROM images WHERE id = ?", imageId).
		Scan(&filename, &contentType, &data)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found.",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image.",
		})
	}

	// Set content type to the original image type
	c.Set("Content-Type", contentType)
	// Display inline (viewable in browser, not download)
	c.Set("Content-Disposition", "inline")
	// Ensure nosniff is set (already set by middleware, but reinforce)
	c.Set("X-Content-Type-Options", "nosniff")

	// For SVG, override CSP to be extra restrictive to prevent XSS
	if contentType == "image/svg+xml" {
		c.Set("Content-Security-Policy", "default-src 'none'; style-src 'none'; script-src 'none'")
	}

	return c.Send(data)
}