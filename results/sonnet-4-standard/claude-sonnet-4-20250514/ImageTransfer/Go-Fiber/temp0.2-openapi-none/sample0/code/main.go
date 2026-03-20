package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type ImageRecord struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	MimeType string `json:"mime_type"`
	FilePath string `json:"file_path"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./images.db")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		mime_type TEXT NOT NULL,
		file_path TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func saveImage(file *fiber.Map, filename string) (*ImageRecord, error) {
	id := uuid.New().String()
	
	// Create uploads directory if it doesn't exist
	uploadsDir := "./uploads"
	if err := os.MkdirAll(uploadsDir, 0755); err != nil {
		return nil, err
	}

	// Get file extension and determine mime type
	ext := filepath.Ext(filename)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// Create file path
	filePath := filepath.Join(uploadsDir, id+ext)

	// Save file to disk
	fileHeader := (*file)["file"].(*fiber.FormFile)
	if err := (*fiber.Ctx)((*file)["ctx"].(*fiber.Ctx)).SaveFile(fileHeader, filePath); err != nil {
		return nil, err
	}

	// Save to database
	record := &ImageRecord{
		ID:       id,
		Filename: filename,
		MimeType: mimeType,
		FilePath: filePath,
	}

	insertSQL := `INSERT INTO images (id, filename, mime_type, file_path) VALUES (?, ?, ?, ?)`
	_, err := db.Exec(insertSQL, record.ID, record.Filename, record.MimeType, record.FilePath)
	if err != nil {
		os.Remove(filePath) // Clean up file if database insert fails
		return nil, err
	}

	return record, nil
}

func getImageByID(id string) (*ImageRecord, error) {
	record := &ImageRecord{}
	query := `SELECT id, filename, mime_type, file_path FROM images WHERE id = ?`
	
	err := db.QueryRow(query, id).Scan(&record.ID, &record.Filename, &record.MimeType, &record.FilePath)
	if err != nil {
		return nil, err
	}

	return record, nil
}

func uploadHandler(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	// Check if file is an image (basic validation)
	filename := file.Filename
	ext := strings.ToLower(filepath.Ext(filename))
	validExts := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".gif": true,
		".bmp": true, ".webp": true, ".tiff": true, ".svg": true,
	}

	if !validExts[ext] {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid file format. Please upload an image file.",
		})
	}

	// Create a map to pass both file and context
	fileMap := fiber.Map{
		"file": file,
		"ctx":  c,
	}

	record, err := saveImage(&fileMap, filename)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save image",
		})
	}

	return c.JSON(fiber.Map{
		"id": record.ID,
	})
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")
	
	record, err := getImageByID(imageID)
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

	// Check if file exists
	if _, err := os.Stat(record.FilePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image file not found",
		})
	}

	// Open and read the file
	file, err := os.Open(record.FilePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read image",
		})
	}
	defer file.Close()

	// Read file content
	fileContent, err := io.ReadAll(file)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to read image content",
		})
	}

	// Set appropriate headers for browser viewing
	c.Set("Content-Type", record.MimeType)
	c.Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", record.Filename))
	
	return c.Send(fileContent)
}

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Create Fiber app
	app := fiber.New()

	// Routes
	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	// Start server
	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}