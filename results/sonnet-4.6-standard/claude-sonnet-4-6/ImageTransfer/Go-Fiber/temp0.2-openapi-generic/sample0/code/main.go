package main

import (
	"database/sql"
	"encoding/base64"
	"io"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
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

func uploadImage(c *fiber.Ctx) error {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided or invalid input",
		})
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read uploaded file",
		})
	}

	if len(data) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Empty file provided",
		})
	}

	// Detect MIME type
	mimeType := http.DetectContentType(data)

	// Use provided content type if available and more specific
	if fileHeader.Header.Get("Content-Type") != "" {
		ct := fileHeader.Header.Get("Content-Type")
		if ct != "application/octet-stream" {
			mimeType = ct
		}
	}

	id := uuid.New().String()

	// Store as base64 encoded string
	encoded := base64.StdEncoding.EncodeToString(data)

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

	var encoded string
	var mimeType string
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

	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to decode image data",
		})
	}

	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", "inline")
	c.Set("X-Content-Type-Options", "nosniff")

	return c.Status(fiber.StatusOK).Send(data)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", getImage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}