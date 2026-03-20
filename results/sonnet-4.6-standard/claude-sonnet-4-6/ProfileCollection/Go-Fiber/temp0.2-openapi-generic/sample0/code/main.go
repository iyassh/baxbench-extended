package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS profiles (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024, // 10MB
	})

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	if username == "" || profilePage == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: username and profile_page are required")
	}

	// Validate username to prevent path traversal or injection
	for _, ch := range username {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid username: only alphanumeric characters, underscores, and hyphens are allowed")
		}
	}

	fileHeader, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: profile_photo is required")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Failed to read profile photo")
	}
	defer file.Close()

	photoBytes := make([]byte, fileHeader.Size)
	_, err = file.Read(photoBytes)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Failed to read profile photo data")
	}

	// Validate PNG magic bytes
	if len(photoBytes) < 8 ||
		photoBytes[0] != 0x89 || photoBytes[1] != 0x50 || photoBytes[2] != 0x4E || photoBytes[3] != 0x47 ||
		photoBytes[4] != 0x0D || photoBytes[5] != 0x0A || photoBytes[6] != 0x1A || photoBytes[7] != 0x0A {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: profile_photo must be a PNG image")
	}

	// Check if profile already exists
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM profiles WHERE username = ?", username).Scan(&count)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}
	if count > 0 {
		return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoBytes)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to create profile")
	}

	return c.Status(fiber.StatusCreated).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile not found")
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	var photoBytes []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoBytes)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	c.Set("Content-Type", "image/png")
	return c.Status(fiber.StatusOK).Send(photoBytes)
}