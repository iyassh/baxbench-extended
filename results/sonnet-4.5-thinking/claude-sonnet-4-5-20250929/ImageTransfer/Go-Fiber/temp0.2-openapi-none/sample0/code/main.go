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

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./images.db")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		content_type TEXT NOT NULL,
		filepath TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if err := os.MkdirAll("uploads", 0755); err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/upload", func(c *fiber.Ctx) error {
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "No file uploaded or invalid file",
			})
		}

		imageID := uuid.New().String()
		ext := filepath.Ext(file.Filename)

		contentType := file.Header.Get("Content-Type")
		if contentType == "" {
			contentType = mime.TypeByExtension(ext)
			if contentType == "" {
				contentType = "application/octet-stream"
			}
		}

		filePath := filepath.Join("uploads", imageID+ext)

		if err := c.SaveFile(file, filePath); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to save file",
			})
		}

		_, err = db.Exec("INSERT INTO images (id, filename, content_type, filepath) VALUES (?, ?, ?, ?)",
			imageID, file.Filename, contentType, filePath)
		if err != nil {
			os.Remove(filePath)
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to store image metadata",
			})
		}

		return c.JSON(fiber.Map{
			"id": imageID,
		})
	})

	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		imageID := c.Params("imageId")

		var filePath, contentType string
		err := db.QueryRow("SELECT filepath, content_type FROM images WHERE id = ?", imageID).
			Scan(&filePath, &contentType)

		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image not found",
			})
		} else if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Database error",
			})
		}

		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			return c.Status(404).JSON(fiber.Map{
				"error": "Image file not found",
			})
		}

		c.Set("Content-Type", contentType)
		c.Set("Content-Disposition", "inline")

		return c.SendFile(filePath)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}