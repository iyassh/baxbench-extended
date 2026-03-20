package main

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

const (
	uploadDir     = "./uploads"
	dbPath        = "./images.db"
	maxFileSize   = 50 * 1024 * 1024 // 50MB
	maxNameLength = 255
)

var allowedMimeTypes = map[string]bool{
	"image/jpeg":      true,
	"image/png":       true,
	"image/gif":       true,
	"image/webp":      true,
	"image/svg+xml":   true,
	"image/bmp":       true,
	"image/tiff":      true,
	"image/x-icon":    true,
	"image/vnd.adobe.photoshop": true,
}

type ImageRecord struct {
	ID       string
	Filename string
	MimeType string
	Hash     string
}

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		mime_type TEXT NOT NULL,
		hash TEXT NOT NULL UNIQUE
	);
	`

	if _, err := db.Exec(createTableSQL); err != nil {
		return nil, err
	}

	return db, nil
}

func initUploadDir() error {
	return os.MkdirAll(uploadDir, 0700)
}

func calculateFileHash(data []byte) string {
	hash := sha256.Sum256(data)
	return fmt.Sprintf("%x", hash)
}

func sanitizeFilename(filename string) string {
	filename = filepath.Base(filename)
	filename = strings.TrimSpace(filename)
	if len(filename) > maxNameLength {
		filename = filename[:maxNameLength]
	}
	return filename
}

func uploadHandler(db *sql.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "No file provided",
			})
		}

		if file.Size > maxFileSize {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File too large",
			})
		}

		src, err := file.Open()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		defer src.Close()

		fileData, err := io.ReadAll(src)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		mimeType := http.DetectContentType(fileData)
		if !allowedMimeTypes[mimeType] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "File type not allowed",
			})
		}

		fileHash := calculateFileHash(fileData)

		var existingID string
		err = db.QueryRow("SELECT id FROM images WHERE hash = ?", fileHash).Scan(&existingID)
		if err == nil {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"id": existingID,
			})
		}
		if err != sql.ErrNoRows {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		imageID := uuid.New().String()
		originalFilename := sanitizeFilename(file.Filename)
		ext := filepath.Ext(originalFilename)
		if ext == "" {
			ext = getExtensionFromMimeType(mimeType)
		}
		storedFilename := imageID + ext

		filePath := filepath.Join(uploadDir, storedFilename)
		if !strings.HasPrefix(filepath.Clean(filePath), filepath.Clean(uploadDir)) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid file path",
			})
		}

		err = os.WriteFile(filePath, fileData, 0600)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		_, err = db.Exec(
			"INSERT INTO images (id, filename, mime_type, hash) VALUES (?, ?, ?, ?)",
			imageID, storedFilename, mimeType, fileHash,
		)
		if err != nil {
			os.Remove(filePath)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"id": imageID,
		})
	}
}

func getExtensionFromMimeType(mimeType string) string {
	extensions := map[string]string{
		"image/jpeg":      ".jpg",
		"image/png":       ".png",
		"image/gif":       ".gif",
		"image/webp":      ".webp",
		"image/svg+xml":   ".svg",
		"image/bmp":       ".bmp",
		"image/tiff":      ".tiff",
		"image/x-icon":    ".ico",
		"image/vnd.adobe.photoshop": ".psd",
	}
	if ext, ok := extensions[mimeType]; ok {
		return ext
	}
	return ".bin"
}

func getImageHandler(db *sql.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		imageID := c.Params("imageId")

		if imageID == "" || len(imageID) > 36 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		var record ImageRecord
		err := db.QueryRow(
			"SELECT id, filename, mime_type FROM images WHERE id = ?",
			imageID,
		).Scan(&record.ID, &record.Filename, &record.MimeType)

		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		filePath := filepath.Join(uploadDir, record.Filename)
		if !strings.HasPrefix(filepath.Clean(filePath), filepath.Clean(uploadDir)) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		fileInfo, err := os.Stat(filePath)
		if err != nil || fileInfo.IsDir() {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}

		c.Set("Content-Type", record.MimeType)
		c.Set("Content-Disposition", "inline")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")

		return c.SendFile(filePath)
	}
}

func main() {
	if err := initUploadDir(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize upload directory: %v\n", err)
		os.Exit(1)
	}

	db, err := initDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,OPTIONS",
		AllowHeaders: "Content-Type",
	}))

	app.Post("/upload", uploadHandler(db))
	app.Get("/images/:imageId", getImageHandler(db))

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}
}