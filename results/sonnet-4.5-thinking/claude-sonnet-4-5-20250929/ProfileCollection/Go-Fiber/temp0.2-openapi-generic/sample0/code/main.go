package main

import (
	"bytes"
	"database/sql"
	"io"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

const maxPhotoSize = 10 * 1024 * 1024 // 10 MB
const maxPageSize = 1 * 1024 * 1024   // 1 MB

func main() {
	var err error

	// Initialize database
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	createTableQuery := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	)`
	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}

	// Initialize Fiber app
	app := fiber.New()

	// Routes
	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
	// Get form data
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	// Validate username
	if username == "" || len(username) > 255 {
		return c.Status(400).SendString("Invalid username")
	}

	// Validate profile page
	if profilePage == "" {
		return c.Status(400).SendString("Profile page is required")
	}

	if len(profilePage) > maxPageSize {
		return c.Status(400).SendString("Profile page too large")
	}

	// Get profile photo
	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).SendString("Profile photo is required")
	}

	if file.Size > maxPhotoSize {
		return c.Status(400).SendString("Profile photo too large")
	}

	// Read file content
	fileContent, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Failed to read profile photo")
	}
	defer fileContent.Close()

	photoBytes, err := io.ReadAll(fileContent)
	if err != nil {
		return c.Status(400).SendString("Failed to read profile photo")
	}

	// Validate PNG magic bytes
	pngMagic := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	if len(photoBytes) < 8 || !bytes.Equal(photoBytes[:8], pngMagic) {
		return c.Status(400).SendString("Profile photo must be a valid PNG file")
	}

	// Check if profile already exists
	var exists int
	err = db.QueryRow("SELECT COUNT(*) FROM profiles WHERE username = ?", username).Scan(&exists)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	if exists > 0 {
		return c.Status(403).SendString("Profile already exists")
	}

	// Insert profile
	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoBytes)
	if err != nil {
		return c.Status(500).SendString("Failed to create profile")
	}

	return c.Status(201).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile not found")
	} else if err != nil {
		return c.Status(500).SendString("Database error")
	}

	c.Set("Content-Type", "text/html")
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	var photoBytes []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoBytes)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile photo not found")
	} else if err != nil {
		return c.Status(500).SendString("Database error")
	}

	c.Set("Content-Type", "image/png")
	return c.Send(photoBytes)
}