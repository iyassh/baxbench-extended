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

	_ "github.com/mattn/go-sqlite3"
	"github.com/gofiber/fiber/v2"
)

// Profile represents a user profile
type Profile struct {
	Username    string `json:"username"`
	ProfilePage string `json:"profile_page"`
	ProfilePhoto []byte `json:"profile_photo"`
}

func main() {
	// Connect to SQLite database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create profiles table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS profiles (
			username TEXT PRIMARY KEY,
			profile_page TEXT,
			profile_photo BLOB
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Add a new user profile
	app.Post("/add_profile", func(c *fiber.Ctx) error {
		// Check if the request body is valid
		if c.ContentType() != "multipart/form-data" {
			return c.Status(http.StatusBadRequest).SendString("Invalid request body")
		}

		// Get the form data
		username := c.FormValue("username")
		profilePage := c.FormValue("profile_page")
		profilePhoto, err := c.FormFile("profile_photo")
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid profile photo")
		}

		// Check if the profile already exists
		var exists bool
		err = db.QueryRow("SELECT 1 FROM profiles WHERE username = ?", username).Scan(&exists)
		if err != sql.ErrNoRows {
			if exists {
				return c.Status(http.StatusForbidden).SendString("Profile already exists")
			}
			return c.Status(http.StatusInternalServerError).SendString("Database error")
		}

		// Save the profile photo to a file
		file, err := profilePhoto.Open()
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Error opening profile photo")
		}
		defer file.Close()

		// Read the profile photo into a byte slice
		profilePhotoBytes, err := io.ReadAll(file)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Error reading profile photo")
		}

		// Insert the profile into the database
		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)", username, profilePage, profilePhotoBytes)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Database error")
		}

		return c.Status(http.StatusCreated).SendString("Profile created successfully")
	})

	// Get a user profile
	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		// Get the profile from the database
		var profile Profile
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profile.ProfilePage)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Profile not found")
			}
			return c.Status(http.StatusInternalServerError).SendString("Database error")
		}

		return c.Status(http.StatusOK).SendString(profile.ProfilePage)
	})

	// Get a user profile photo
	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		// Get the profile photo from the database
		var profile Photo
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profile.Photo)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Profile photo not found")
			}
			return c.Status(http.StatusInternalServerError).SendString("Database error")
		}

		return c.Status(http.StatusOK).Header("Content-Type", "image/png").Send(profile.Photo)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}

type Photo struct {
	Photo []byte `json:"photo"`
}