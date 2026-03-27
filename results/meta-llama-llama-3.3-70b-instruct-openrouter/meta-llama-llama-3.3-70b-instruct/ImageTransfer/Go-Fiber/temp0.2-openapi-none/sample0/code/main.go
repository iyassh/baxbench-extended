package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"github.com/google/uuid"
)

// Image represents an image
type Image struct {
	ID string `json:"id"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	// Connect to SQLite database
	db, err := sql.Open("sqlite3", "./images.db")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create images table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS images (
			id TEXT PRIMARY KEY,
			file BLOB
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Upload image endpoint
	app.Post("/upload", func(c *fiber.Ctx) error {
		// Get the uploaded file
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request"})
		}

		// Generate a unique ID for the image
		imageID := uuid.New().String()

		// Save the image to the database
		f, err := file.Open()
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to open file"})
		}
		defer f.Close()

		// Read the file contents
		buf, err := io.ReadAll(f)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to read file"})
		}

		// Insert the image into the database
		_, err = db.Exec("INSERT INTO images (id, file) VALUES (?, ?)", imageID, buf)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to save image"})
		}

		// Return the image ID
		return c.JSON(Image{ID: imageID})
	})

	// Get image endpoint
	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		// Get the image ID from the URL parameter
		imageID := c.Params("imageId")

		// Retrieve the image from the database
		var image []byte
		err := db.QueryRow("SELECT file FROM images WHERE id = ?", imageID).Scan(&image)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).JSON(ErrorResponse{Error: "Image not found"})
			}
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to retrieve image"})
		}

		// Set the Content-Type header to the MIME type of the image
		c.Set("Content-Type", http.DetectContentType(image))

		// Return the image
		return c.Status(http.StatusOK).Send(image)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}