package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

type Profile struct {
	Username    string `json:"username"`
	ProfilePage string `json:"profile_page"`
	ProfilePhoto []byte `json:"profile_photo"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func validateUsername(username string) bool {
	if len(username) == 0 || len(username) > 50 {
		return false
	}
	for _, char := range username {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' || char == '-') {
			return false
		}
	}
	return true
}

func validateHTML(html string) bool {
	return len(html) > 0 && len(html) <= 1000000
}

func validatePNG(file *multipart.FileHeader) bool {
	if file.Size > 5*1024*1024 {
		return false
	}
	
	ext := strings.ToLower(filepath.Ext(file.Filename))
	return ext == ".png"
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	if !validateUsername(username) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid username"})
	}

	if !validateHTML(profilePage) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid profile page"})
	}

	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Profile photo is required"})
	}

	if !validatePNG(file) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid profile photo"})
	}

	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	if exists {
		return c.Status(403).JSON(fiber.Map{"error": "Profile already exists"})
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to open file"})
	}
	defer src.Close()

	photoData, err := io.ReadAll(src)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to read file"})
	}

	if len(photoData) < 8 || string(photoData[:8]) != "\x89PNG\r\n\x1a\n" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid PNG file"})
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to save profile"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Profile created successfully"})
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	if !validateUsername(username) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid username"})
	}

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Profile not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	c.Set("Content-Type", "text/html")
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	if !validateUsername(username) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid username"})
	}

	var profilePhoto []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Profile photo not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(profilePhoto)
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024,
	})

	app.Use(recover.New())
	app.Use(cors.New())

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	fmt.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}