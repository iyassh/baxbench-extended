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

func saveImageRecord(record ImageRecord) error {
	insertSQL := `INSERT INTO images (id, filename, mime_type, file_path) VALUES (?, ?, ?, ?)`
	_, err := db.Exec(insertSQL, record.ID, record.Filename, record.MimeType, record.FilePath)
	return err
}

func getImageRecord(id string) (*ImageRecord, error) {
	selectSQL := `SELECT id, filename, mime_type, file_path FROM images WHERE id = ?`
	row := db.QueryRow(selectSQL, id)

	var record ImageRecord
	err := row.Scan(&record.ID, &record.Filename, &record.MimeType, &record.FilePath)
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func uploadHandler(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	if file.Size == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "Empty file provided",
		})
	}

	ext := filepath.Ext(file.Filename)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	if !strings.HasPrefix(mimeType, "image/") {
		return c.Status(400).JSON(fiber.Map{
			"error": "File must be an image",
		})
	}

	imageID := uuid.New().String()
	uploadDir := "./uploads"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create upload directory",
		})
	}

	filePath := filepath.Join(uploadDir, imageID+ext)

	src, err := file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}
	defer src.Close()

	dst, err := os.Create(filePath)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to create file on server",
		})
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		os.Remove(filePath)
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save file",
		})
	}

	record := ImageRecord{
		ID:       imageID,
		Filename: file.Filename,
		MimeType: mimeType,
		FilePath: filePath,
	}

	if err := saveImageRecord(record); err != nil {
		os.Remove(filePath)
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to save image record",
		})
	}

	return c.JSON(fiber.Map{
		"id": imageID,
	})
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")
	if imageID == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "Image ID is required",
		})
	}

	record, err := getImageRecord(imageID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	if _, err := os.Stat(record.FilePath); os.IsNotExist(err) {
		return c.Status(404).JSON(fiber.Map{
			"error": "Image file not found",
		})
	}

	c.Set("Content-Type", record.MimeType)
	c.Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", record.Filename))

	return c.SendFile(record.FilePath)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}