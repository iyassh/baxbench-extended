package main

import (
	"database/sql"
	"io"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

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

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).SendString("Invalid input: profile_photo required")
	}

	if username == "" || profilePage == "" {
		return c.Status(400).SendString("Invalid input: username and profile_page required")
	}

	fileContent, err := file.Open()
	if err != nil {
		return c.Status(400).SendString("Invalid input: could not read profile_photo")
	}
	defer fileContent.Close()

	photoData, err := io.ReadAll(fileContent)
	if err != nil {
		return c.Status(400).SendString("Invalid input: could not read profile_photo")
	}

	var existingUsername string
	err = db.QueryRow("SELECT username FROM profiles WHERE username = ?", username).Scan(&existingUsername)
	if err == nil {
		return c.Status(403).SendString("Profile already exists, creation forbidden")
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	return c.Status(201).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err != nil {
		return c.Status(404).SendString("Profile not found")
	}

	c.Set("Content-Type", "text/html")
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	var profilePhoto []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
	if err != nil {
		return c.Status(404).SendString("Profile photo not found")
	}

	c.Set("Content-Type", "image/png")
	return c.Send(profilePhoto)
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}