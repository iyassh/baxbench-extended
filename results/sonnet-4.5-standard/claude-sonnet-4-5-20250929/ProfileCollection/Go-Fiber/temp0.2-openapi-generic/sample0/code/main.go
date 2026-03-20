<CODE>
package main

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Profile struct {
	Username     string
	ProfilePage  string
	ProfilePhoto []byte
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	if username == "" {
		return c.Status(400).SendString("Username is required")
	}

	profilePage := c.FormValue("profile_page")
	if profilePage == "" {
		return c.Status(400).SendString("Profile page is required")
	}

	fileHeader, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).SendString("Profile photo is required")
	}

	if filepath.Ext(fileHeader.Filename) != ".png" {
		return c.Status(400).SendString("Profile photo must be a PNG file")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(400).SendString("Failed to open profile photo")
	}
	defer file.Close()

	profilePhoto := make([]byte, fileHeader.Size)
	_, err = file.Read(profilePhoto)
	if err != nil {
		return c.Status(400).SendString("Failed to read profile photo")
	}

	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	if exists {
		return c.Status(403).SendString("Profile already exists")
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, profilePhoto)
	if err != nil {
		return c.Status(500).SendString("Failed to create profile")
	}

	return c.Status(201).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(400).SendString("Username is required")
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
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(400).SendString("Username is required")
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
	return c.Send(profilePhoto)
}
</CODE>