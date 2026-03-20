package main

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"io"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
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
		data BLOB NOT NULL,
		mime_type TEXT NOT NULL
	)`)
	return err
}

func generateID() (string, error) {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func isAllowedImageMimeType(mime string) bool {
	allowed := map[string]bool{
		"image/jpeg":    true,
		"image/png":     true,
		"image/gif":     true,
		"image/webp":    true,
		"image/bmp":     true,
		"image/tiff":    true,
		"image/svg+xml": false, // SVG can contain scripts, disallow
		"image/ico":     true,
		"image/x-icon":  true,
	}
	v, ok := allowed[mime]
	return ok && v
}

func detectMimeType(data []byte) string {
	return http.DetectContentType(data)
}

func uploadHandler(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	// Limit file size to 10MB
	const maxSize = 10 * 1024 * 1024
	if fileHeader.Size > maxSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open file",
		})
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxSize+1))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read file",
		})
	}

	if len(data) > maxSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "File too large",
		})
	}

	// Detect MIME type from actual content (not from client-provided header)
	mimeType := http.DetectContentType(data)

	// Validate it's an allowed image type
	if !isAllowedImageMimeType(mimeType) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid file type. Only image files are allowed.",
		})
	}

	// Additional check: verify magic bytes for common image formats
	if !isValidImageBytes(data) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid image file",
		})
	}

	id, err := generateID()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate ID",
		})
	}

	_, err = db.Exec("INSERT INTO images (id, data, mime_type) VALUES (?, ?, ?)", id, data, mimeType)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to store image",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": id,
	})
}

func isValidImageBytes(data []byte) bool {
	if len(data) < 4 {
		return false
	}

	// JPEG: FF D8 FF
	if bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}) {
		return true
	}
	// PNG: 89 50 4E 47
	if bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4E, 0x47}) {
		return true
	}
	// GIF: GIF87a or GIF89a
	if bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")) {
		return true
	}
	// BMP: BM
	if bytes.HasPrefix(data, []byte{0x42, 0x4D}) {
		return true
	}
	// WEBP: RIFF....WEBP
	if len(data) >= 12 && bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return true
	}
	// TIFF: little-endian or big-endian
	if bytes.HasPrefix(data, []byte{0x49, 0x49, 0x2A, 0x00}) || bytes.HasPrefix(data, []byte{0x4D, 0x4D, 0x00, 0x2A}) {
		return true
	}
	// ICO
	if bytes.HasPrefix(data, []byte{0x00, 0x00, 0x01, 0x00}) {
		return true
	}

	return false
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Validate imageID format (should be hex string of 32 chars)
	if len(imageID) != 32 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	for _, ch := range imageID {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
	}

	var data []byte
	var mimeType string
	err := db.QueryRow("SELECT data, mime_type FROM images WHERE id = ?", imageID).Scan(&data, &mimeType)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image",
		})
	}

	// Set headers to display inline (not download) and security headers
	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", "inline")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "SAMEORIGIN")
	c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'")
	c.Set("Cache-Control", "public, max-age=31536000")

	return c.Status(fiber.StatusOK).Send(data)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking sensitive info
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
		BodyLimit: 11 * 1024 * 1024, // slightly above our 10MB limit
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}