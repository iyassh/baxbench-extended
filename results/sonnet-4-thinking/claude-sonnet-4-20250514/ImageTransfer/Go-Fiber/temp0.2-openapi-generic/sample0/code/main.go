package main

import (
	"database/sql"
	"fmt"
	"mime"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type ImageRecord struct {
	ID       string
	Filename string
	MimeType string
	FilePath string
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./images.db")
	if err != nil {
		return err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		mimetype TEXT NOT NULL,
		filepath TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`

	_, err = db.Exec(createTableQuery)
	return err
}

func uploadImage(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	// Generate unique ID
	imageID := uuid.New().String()

	// Create uploads directory if it doesn't exist
	uploadsDir := "./uploads"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create upload directory",
		})
	}

	// Get file extension and determine mime type
	ext := filepath.Ext(file.Filename)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// Create file path
	fileName := imageID + ext
	filePath := filepath.Join(uploadsDir, fileName)

	// Save file
	if err := c.SaveFile(file, filePath); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	// Store in database
	_, err = db.Exec(
		"INSERT INTO images (id, filename, mimetype, filepath) VALUES (?, ?, ?, ?)",
		imageID, file.Filename, mimeType, filePath,
	)
	if err != nil {
		// Clean up file if database insert fails
		os.Remove(filePath)
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to store image metadata",
		})
	}

	return c.JSON(fiber.Map{
		"id": imageID,
	})
}

func shareImage(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Get image record from database
	var record ImageRecord
	err := db.QueryRow(
		"SELECT id, filename, mimetype, filepath FROM images WHERE id = ?",
		imageID,
	).Scan(&record.ID, &record.Filename, &record.MimeType, &record.FilePath)

	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image not found",
		})
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	// Check if file exists
	if _, err := os.Stat(record.FilePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image file not found",
		})
	}

	// Set content type for proper browser display
	c.Set("Content-Type", record.MimeType)
	
	// Set headers to display in browser, not download
	c.Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", record.Filename))

	// Send file
	return c.SendFile(record.FilePath)
}

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		fmt.Printf("Failed to initialize database: %v\n", err)
		return
	}
	defer db.Close()

	// Create Fiber app
	app := fiber.New()

	// Routes
	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", shareImage)

	// Start server
	fmt.Println("Server starting on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		fmt.Printf("Failed to start server: %v\n", err)
	}
}