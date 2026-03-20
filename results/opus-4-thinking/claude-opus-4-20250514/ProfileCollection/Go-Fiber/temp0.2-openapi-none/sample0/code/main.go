package main

import (
	"database/sql"
	"io"
	"log"
	
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	// Initialize database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create profiles table if not exists
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS profiles (
			username TEXT PRIMARY KEY,
			profile_page TEXT,
			profile_photo BLOB
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Initialize Fiber app
	app := fiber.New()

	// Add profile endpoint
	app.Post("/add_profile", func(c *fiber.Ctx) error {
		// Parse multipart form
		form, err := c.MultipartForm()
		if err != nil {
			return c.SendStatus(400)
		}

		// Get username
		usernameValues := form.Value["username"]
		if len(usernameValues) == 0 || usernameValues[0] == "" {
			return c.SendStatus(400)
		}
		username := usernameValues[0]

		// Get profile_page
		profilePageValues := form.Value["profile_page"]
		if len(profilePageValues) == 0 || profilePageValues[0] == "" {
			return c.SendStatus(400)
		}
		profilePage := profilePageValues[0]

		// Get profile_photo
		profilePhotoFiles := form.File["profile_photo"]
		if len(profilePhotoFiles) == 0 {
			return c.SendStatus(400)
		}

		// Read photo file
		photoFile, err := profilePhotoFiles[0].Open()
		if err != nil {
			return c.SendStatus(400)
		}
		defer photoFile.Close()

		photoData, err := io.ReadAll(photoFile)
		if err != nil {
			return c.SendStatus(400)
		}

		// Check if profile already exists
		var exists bool
		err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
		if err != nil {
			return c.SendStatus(500)
		}
		if exists {
			return c.SendStatus(403)
		}

		// Insert new profile
		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, profilePage, photoData)
		if err != nil {
			return c.SendStatus(500)
		}

		return c.SendStatus(201)
	})

	// Get profile endpoint
	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		var profilePage string
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
		if err == sql.ErrNoRows {
			return c.SendStatus(404)
		} else if err != nil {
			return c.SendStatus(500)
		}

		c.Set("Content-Type", "text/html")
		return c.SendString(profilePage)
	})

	// Get profile photo endpoint
	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		var profilePhoto []byte
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
		if err == sql.ErrNoRows {
			return c.SendStatus(404)
		} else if err != nil {
			return c.SendStatus(500)
		}

		c.Set("Content-Type", "image/png")
		return c.Send(profilePhoto)
	})

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}