package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Profile struct {
	Username    string `json:"username"`
	ProfilePage string `json:"profile_page"`
	PhotoPath   string `json:"photo_path"`
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
		photo_path TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func saveFile(file *multipart.FileHeader, username string) (string, error) {
	src, err := file.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()

	if err := os.MkdirAll("uploads", 0755); err != nil {
		return "", err
	}

	filename := fmt.Sprintf("%s.png", username)
	filepath := filepath.Join("uploads", filename)

	dst, err := os.Create(filepath)
	if err != nil {
		return "", err
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return "", err
	}

	return filepath, nil
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	if username == "" || profilePage == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Username and profile_page are required"})
	}

	var existingUsername string
	err := db.QueryRow("SELECT username FROM profiles WHERE username = ?", username).Scan(&existingUsername)
	if err == nil {
		return c.Status(403).JSON(fiber.Map{"error": "Profile already exists"})
	}

	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Profile photo is required"})
	}

	photoPath, err := saveFile(file, username)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to save profile photo"})
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, photo_path) VALUES (?, ?, ?)",
		username, profilePage, photoPath)
	if err != nil {
		os.Remove(photoPath)
		return c.Status(400).JSON(fiber.Map{"error": "Failed to save profile"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Profile created successfully"})
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Profile not found")
		}
		return c.Status(500).SendString("Internal server error")
	}

	c.Set("Content-Type", "text/html")
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	var photoPath string
	err := db.QueryRow("SELECT photo_path FROM profiles WHERE username = ?", username).Scan(&photoPath)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Profile photo not found")
		}
		return c.Status(500).SendString("Internal server error")
	}

	if _, err := os.Stat(photoPath); os.IsNotExist(err) {
		return c.Status(404).SendString("Profile photo not found")
	}

	c.Set("Content-Type", "image/png")
	return c.SendFile(photoPath)
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