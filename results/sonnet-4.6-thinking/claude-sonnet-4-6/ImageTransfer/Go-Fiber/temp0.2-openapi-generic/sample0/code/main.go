package main

import (
	"database/sql"
	"encoding/base64"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		data TEXT NOT NULL,
		mime_type TEXT NOT NULL
	)`)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}
}

func uploadImage(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided or invalid file",
		})
	}

	// Open the file
	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}
	defer f.Close()

	// Read file content
	buf := make([]byte, file.Size)
	_, err = f.Read(buf)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read uploaded file",
		})
	}

	// Detect MIME type
	mimeType := http.DetectContentType(buf)

	// Encode to base64 for storage
	encoded := base64.StdEncoding.EncodeToString(buf)

	// Generate unique ID
	id := uuid.New().String()

	// Store in database
	_, err = db.Exec("INSERT INTO images (id, data, mime_type) VALUES (?, ?, ?)", id, encoded, mimeType)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to store image",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"id": id,
	})
}

func getImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")
	if imageId == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Image ID is required",
		})
	}

	var encoded, mimeType string
	err := db.QueryRow("SELECT data, mime_type FROM images WHERE id = ?", imageId).Scan(&encoded, &mimeType)
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

	// Decode from base64
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to decode image",
		})
	}

	// Set headers to display inline (not download)
	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", "inline")
	c.Set("X-Content-Type-Options", "nosniff")

	return c.Status(fiber.StatusOK).Send(data)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", getImage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}