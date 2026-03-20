package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/add_profile", func(c *fiber.Ctx) error {
		username := c.FormValue("username")
		profilePage := c.FormValue("profile_page")

		if username == "" || profilePage == "" {
			return c.Status(400).SendString("Invalid input: username and profile_page are required")
		}

		file, err := c.FormFile("profile_photo")
		if err != nil {
			return c.Status(400).SendString("Invalid input: profile_photo is required")
		}

		f, err := file.Open()
		if err != nil {
			return c.Status(400).SendString("Invalid input: could not open profile_photo")
		}
		defer f.Close()

		photoData := make([]byte, file.Size)
		_, err = f.Read(photoData)
		if err != nil {
			return c.Status(400).SendString("Invalid input: could not read profile_photo")
		}

		var existing string
		err = db.QueryRow("SELECT username FROM profiles WHERE username = ?", username).Scan(&existing)
		if err == nil {
			return c.Status(403).SendString("Profile already exists")
		}

		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, profilePage, photoData)
		if err != nil {
			return c.Status(500).SendString("Could not save profile")
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
		return c.Status(200).SendString(profilePage)
	})

	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		var photoData []byte
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Profile photo not found")
		}
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		c.Set("Content-Type", "image/png")
		return c.Status(200).Send(photoData)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}