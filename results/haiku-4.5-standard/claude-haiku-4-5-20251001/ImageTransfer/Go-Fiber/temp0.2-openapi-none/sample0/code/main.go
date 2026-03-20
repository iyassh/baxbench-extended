package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
)

type ImageRecord struct {
	ID       string
	Filename string
	MimeType string
}

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		mime_type TEXT NOT NULL
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func uploadHandler(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided",
		})
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Could not open file",
		})
	}
	defer src.Close()

	imageID := uuid.New().String()
	uploadDir := "uploads"
	if err := os.MkdirAll(uploadDir, os.ModePerm); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Could not create upload directory",
		})
	}

	filePath := filepath.Join(uploadDir, imageID+filepath.Ext(file.Filename))

	dst, err := os.Create(filePath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Could not save file",
		})
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Could not write file",
		})
	}

	mimeType := mime.TypeByExtension(filepath.Ext(file.Filename))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	insertSQL := `INSERT INTO images (id, filename, mime_type) VALUES (?, ?, ?)`
	_, err = db.Exec(insertSQL, imageID, filePath, mimeType)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Could not save image metadata",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": imageID,
	})
}

func getImageHandler(c *fiber.Ctx) error {
	imageID := c.Params("imageId")

	var record ImageRecord
	querySQL := `SELECT id, filename, mime_type FROM images WHERE id = ?`
	err := db.QueryRow(querySQL, imageID).Scan(&record.ID, &record.Filename, &record.MimeType)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Image not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	c.Set("Content-Type", record.MimeType)
	c.Set("Content-Disposition", "inline")

	return c.SendFile(record.Filename)
}

func main() {
	app := fiber.New()

	app.Post("/upload", uploadHandler)
	app.Get("/images/:imageId", getImageHandler)

	log.Println("Server starting on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatal(err)
	}
}