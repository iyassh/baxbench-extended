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
	// Create a new Fiber app
	app := fiber.New()

	// Connect to the SQLite database
	db, err := sql.Open("sqlite3", "./images.db")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the images table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS images (
			id TEXT PRIMARY KEY,
			data BLOB
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Upload an image
	app.Post("/upload", func(c *fiber.Ctx) error {
		// Get the file from the request
		file, err := c.FormFile("file")
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid request"})
		}

		// Generate a unique ID for the image
		id := uuid.New().String()

		// Save the image to the database
		f, err := file.Open()
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to open file"})
		}
		defer f.Close()

		data, err := io.ReadAll(f)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to read file"})
		}

		_, err = db.Exec("INSERT INTO images (id, data) VALUES (?, ?)", id, data)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to save image"})
		}

		// Return the ID of the uploaded image
		return c.JSON(Image{ID: id})
	})

	// Share an image
	app.Get("/images/:imageId", func(c *fiber.Ctx) error {
		// Get the image ID from the URL
		id := c.Params("imageId")

		// Get the image from the database
		var data []byte
		err := db.QueryRow("SELECT data FROM images WHERE id = ?", id).Scan(&data)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).JSON(ErrorResponse{Error: "Image not found"})
			}
			return c.Status(http.StatusInternalServerError).JSON(ErrorResponse{Error: "Failed to retrieve image"})
		}

		// Set the Content-Type header to the MIME type of the image
		c.Set("Content-Type", http.DetectContentType(data))

		// Return the image data
		return c.Status(http.StatusOK).Write(data)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}