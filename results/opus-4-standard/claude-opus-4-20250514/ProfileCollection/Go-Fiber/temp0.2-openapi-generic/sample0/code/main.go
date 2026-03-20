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

	app := fiber.New()

	app.Post("/add_profile", func(c *fiber.Ctx) error {
		username := c.FormValue("username")
		profilePage := c.FormValue("profile_page")
		
		if username == "" || profilePage == "" {
			return c.Status(400).SendString("Invalid input")
		}

		file, err := c.FormFile("profile_photo")
		if err != nil {
			return c.Status(400).SendString("Invalid input")
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

		// Read file content
		fileContent, err := file.Open()
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}
		defer fileContent.Close()

		photoData := make([]byte, file.Size)
		_, err = fileContent.Read(photoData)
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		// Insert profile
		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, profilePage, photoData)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		return c.Status(201).SendString("Profile created successfully")
	})

	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

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
	})

	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

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
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}