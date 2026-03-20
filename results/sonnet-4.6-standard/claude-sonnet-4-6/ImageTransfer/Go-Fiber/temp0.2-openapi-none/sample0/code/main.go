package main

import (
	"database/sql"
	"fmt"
	"net/http"

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

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		mimetype TEXT NOT NULL,
		data BLOB NOT NULL
	)`)
	return err
}

func main() {
	if err := initDB(); err != nil {
		panic(fmt.Sprintf("Failed to initialize database: %v", err))
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024, // 50MB limit
	})

	app.Post("/upload", uploadImage)
	app.Get("/images/:imageId", getImage)

	app.Listen("0.0.0.0:5000")
}

func uploadImage(c *fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "No file provided or invalid file",
		})
	}

	f, err := file.Open()
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}
	defer f.Close()

	// Read file data
	data := make([]byte, file.Size)
	_, err = f.Read(data)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read file data",
		})
	}

	// Detect MIME type
	mimeType := http.DetectContentType(data)

	// Check content type header as fallback
	if file.Header.Get("Content-Type") != "" {
		mimeType = file.Header.Get("Content-Type")
	}

	id := uuid.New().String()

	_, err = db.Exec("INSERT INTO images (id, filename, mimetype, data) VALUES (?, ?, ?, ?)",
		id, file.Filename, mimeType, data)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to store image",
		})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{
		"id": id,
	})
}

func getImage(c *fiber.Ctx) error {
	imageId := c.Params("imageId")

	var filename, mimeType string
	var data []byte

	err := db.QueryRow("SELECT filename, mimetype, data FROM images WHERE id = ?", imageId).
		Scan(&filename, &mimeType, &data)
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

	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, filename))
	c.Set("Cache-Control", "public, max-age=86400")

	return c.Status(http.StatusOK).Send(data)
}