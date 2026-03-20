package main

import (
	"database/sql"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Fatal(app.Listen("0.0.0.0:" + port))
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	if username == "" {
		return c.Status(400).SendString("Invalid input: username is required")
	}

	// Check if username contains only alphanumeric characters, underscore and hyphen
	for _, char := range username {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || 
			(char >= '0' && char <= '9') || char == '_' || char == '-') {
			return c.Status(400).SendString("Invalid input: username contains invalid characters")
		}
	}

	profilePage := c.FormValue("profile_page")
	if profilePage == "" {
		return c.Status(400).SendString("Invalid input: profile_page is required")
	}

	fileHeader, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).SendString("Invalid input: profile_photo is required")
	}

	// Check if file is PNG by checking magic bytes
	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot open profile_photo")
	}
	defer file.Close()

	// Read first 8 bytes to check PNG signature
	pngSignature := []byte{137, 80, 78, 71, 13, 10, 26, 10}
	header := make([]byte, 8)
	_, err = file.Read(header)
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot read profile_photo")
	}

	for i := 0; i < 8; i++ {
		if header[i] != pngSignature[i] {
			return c.Status(400).SendString("Invalid input: profile_photo must be PNG format")
		}
	}

	// Reset file pointer and read entire file
	file.Seek(0, 0)
	photoData := make([]byte, fileHeader.Size)
	_, err = file.Read(photoData)
	if err != nil {
		return c.Status(400).SendString("Invalid input: cannot read profile_photo data")
	}

	// Check if profile already exists
	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	if exists {
		return c.Status(403).SendString("Profile already exists, creation forbidden")
	}

	// Insert new profile
	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.Status(201).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")
	
	// Validate username
	for _, char := range username {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || 
			(char >= '0' && char <= '9') || char == '_' || char == '-') {
			return c.Status(404).SendString("Profile not found")
		}
	}

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile not found")
	}
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	c.Set("Content-Type", "text/html")
	return c.Status(200).SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")
	
	// Validate username
	for _, char := range username {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || 
			(char >= '0' && char <= '9') || char == '_' || char == '-') {
			return c.Status(404).SendString("Profile photo not found")
		}
	}

	var profilePhoto []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile photo not found")
	}
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	c.Set("Content-Type", "image/png")
	return c.Status(200).Send(profilePhoto)
}