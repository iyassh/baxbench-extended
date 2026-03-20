package main

import (
	"bytes"
	"database/sql"
	"io"
	"log"
	"regexp"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

const (
	maxFileSize        = 10 * 1024 * 1024 // 10MB limit
	maxUsernameLength  = 100
	maxProfilePageSize = 5 * 1024 * 1024 // 5MB limit for HTML
)

var (
	db            *sql.DB
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	pngHeader     = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
)

func main() {
	var err error

	// Initialize database
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS profiles (
			username TEXT PRIMARY KEY,
			profile_page TEXT NOT NULL,
			profile_photo BLOB NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Initialize Fiber
	app := fiber.New(fiber.Config{
		BodyLimit: maxFileSize,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "SAMEORIGIN")
		return c.Next()
	})

	// Routes
	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
	// Parse multipart form
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	// Validate username
	if username == "" || len(username) > maxUsernameLength || !usernameRegex.MatchString(username) {
		return c.Status(400).SendString("Invalid input")
	}

	// Validate profile page
	if profilePage == "" || len(profilePage) > maxProfilePageSize {
		return c.Status(400).SendString("Invalid input")
	}

	// Get profile photo
	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Check file size
	if file.Size > maxFileSize || file.Size == 0 {
		return c.Status(400).SendString("Invalid input")
	}

	// Read file content
	fileContent, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}
	defer fileContent.Close()

	photoData, err := io.ReadAll(fileContent)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Validate PNG format (check magic bytes)
	if len(photoData) < 8 || !bytes.Equal(photoData[0:8], pngHeader) {
		return c.Status(400).SendString("Invalid input")
	}

	// Check if profile already exists
	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	if exists {
		return c.Status(403).SendString("Profile already exists")
	}

	// Insert profile
	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	return c.Status(201).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	// Validate username format
	if username == "" || len(username) > maxUsernameLength || !usernameRegex.MatchString(username) {
		return c.Status(404).SendString("Profile not found")
	}

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile not found")
	}
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	// Validate username format
	if username == "" || len(username) > maxUsernameLength || !usernameRegex.MatchString(username) {
		return c.Status(404).SendString("Profile photo not found")
	}

	var photoData []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile photo not found")
	}
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	c.Set("Content-Type", "image/png")
	return c.Send(photoData)
}