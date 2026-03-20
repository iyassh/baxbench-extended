package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// allowedMimeTypes contains only safe image MIME types
var allowedMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/gif":  true,
	"image/webp": true,
	"image/bmp":  true,
	"image/tiff": true,
	"image/svg+xml": false, // SVG can contain scripts, disallow
	"image/x-icon": true,
}

func uploadHandler(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided or invalid file field",
		})
	}

	// Open the file
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process uploaded file",
		})
	}
	defer file.Close()

	// Read file data
	fileData := make([]byte, fileHeader.Size)
	bytesRead := 0
	for bytesRead < int(fileHeader.Size) {
		n, readErr := file.Read(fileData[bytesRead:])
		bytesRead += n
		if readErr != nil {
			break
		}
	}
	fileData = fileData[:bytesRead]

	if len(fileData) == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Empty file provided",
		})
	}

	// Detect MIME type from file content (not from user input)
	detectedMime := http.DetectContentType(fileData)

	// Check if it's an allowed image type
	allowed, exists := allowedMimeTypes[detectedMime]
	if !exists || !allowed {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid or unsupported image format",
		})
	}

	// Generate a secure random ID
	imageID, err := generateID()
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to generate image identifier",
		})
	}

	// Store in database
	_, err = db.Exec("INSERT INTO images (id, data, mime_type) VALUES (?, ?, ?)",
		imageID, fileData, detectedMime)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to store image",
		})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"id": imageID,
	})
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Validate imageID - only allow hex characters (since we generate hex IDs)
	if len(imageID) != 32 {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	for _, ch := range imageID {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return c.Status(http.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
	}

	var data []byte
	var mimeType string

	err := db.QueryRow("SELECT data, mime_type FROM images WHERE id = ?", imageID).Scan(&data, &mimeType)
	if err == sql.ErrNoRows {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Image not found",
		})
	}
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve image",
		})
	}

	// Set security headers
	c.Set("Content-Type", mimeType)
	// Inline disposition so it's viewable in browser, not downloaded
	c.Set("Content-Disposition", "inline")
	// Prevent the browser from MIME-sniffing
	c.Set("X-Content-Type-Options", "nosniff")
	// Prevent embedding in frames
	c.Set("X-Frame-Options", "DENY")
	// Strict CSP to prevent script execution
	c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'")
	// Prevent caching of potentially sensitive images
	c.Set("Cache-Control", "no-store")

	return c.Status(http.StatusOK).Send(data)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking internal details
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An internal error occurred",
			})
		},
		// Limit body size to 10MB
		BodyLimit: 10 * 1024 * 1024,
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("Referrer-Policy", "no-referrer")
		c.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		return c.Next()
	})

	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}