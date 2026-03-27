package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"

	_ "github.com/mattn/go-sqlite3"
	"github.com/gofiber/fiber/v2"
)

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
		// Get form data
		username := c.FormValue("username")
		profilePage := c.FormValue("profile_page")
		profilePhoto, err := c.FormFile("profile_photo")
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		// Check if profile already exists
		var exists bool
		err = db.QueryRow("SELECT 1 FROM profiles WHERE username = ?", username).Scan(&exists)
		if err == nil {
			return c.Status(403).SendString("Profile already exists, creation forbidden")
		}

		// Read profile photo
		file, err := profilePhoto.Open()
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}
		defer file.Close()
		photoBytes := make([]byte, profilePhoto.Size)
		_, err = file.Read(photoBytes)
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		// Insert new profile into database
		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)", username, profilePage, photoBytes)
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		return c.Status(201).SendString("Profile created successfully")
	})

	// Get user profile
	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		// Get profile from database
		var profile Profile
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profile.ProfilePage)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).SendString("Profile not found")
			}
			return c.Status(500).SendString("Internal server error")
		}

		return c.Status(200).SendString(profile.ProfilePage)
	})

	// Get user profile photo
	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		// Get profile photo from database
		var profile Photo
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profile.Photo)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).SendString("Profile photo not found")
			}
			return c.Status(500).SendString("Internal server error")
		}

		return c.Status(200).Send(profile.Photo)
	})

	// Start server
	log.Fatal(app.Listen(":5000"))
}

type Photo struct {
	Photo []byte `json:"photo"`
}