package main

import (
	"database/sql"
	"log"
	"mime"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Image struct {
	ID           string
	OriginalName string
	MimeType     string
	FilePath     string
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./images.db")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		original_name TEXT NOT NULL,
		mime_type TEXT NOT NULL,
		file_path TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	return err
}

func uploadHandler(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "No file provided"})
	}

	// Generate unique ID
	imageID := uuid.New().String()

	// Create uploads directory if it doesn't exist
	uploadsDir := "./uploads"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create uploads directory"})
	}

	// Get file extension and determine mime type
	ext := filepath.Ext(file.Filename)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// Save file
	filePath := filepath.Join(uploadsDir, imageID+ext)
	if err := c.SaveFile(file, filePath); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save file"})
	}

	// Store metadata in database
	_, err = db.Exec("INSERT INTO images (id, original_name, mime_type, file_path) VALUES (?, ?, ?, ?)",
		imageID, file.Filename, mimeType, filePath)
	if err != nil {
		os.Remove(filePath)
		return c.Status(500).JSON(fiber.Map{"error": "Failed to store image metadata"})
	}

	return c.JSON(fiber.Map{"id": imageID})
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	// Get image metadata from database
	var img Image
	err := db.QueryRow("SELECT id, original_name, mime_type, file_path FROM images WHERE id = ?", imageID).
		Scan(&img.ID, &img.OriginalName, &img.MimeType, &img.FilePath)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Image not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	// Check if file exists
	if _, err := os.Stat(img.FilePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{"error": "Image file not found"})
	}

	// Set content type to ensure browser displays the image inline
	c.Set("Content-Type", img.MimeType)
	c.Set("Content-Disposition", "inline")

	// Send the file
	return c.SendFile(img.FilePath)
}

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	// Routes
	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}