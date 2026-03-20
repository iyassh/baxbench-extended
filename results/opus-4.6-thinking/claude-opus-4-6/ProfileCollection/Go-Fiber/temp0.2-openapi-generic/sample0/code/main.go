package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page BLOB NOT NULL,
		profile_photo BLOB NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: 50 * 1024 * 1024,
	})

	app.Post("/add_profile", func(c *fiber.Ctx) error {
		username := c.FormValue("username")
		if username == "" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		profilePage := c.FormValue("profile_page")
		if profilePage == "" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		fileHeader, err := c.FormFile("profile_photo")
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		defer file.Close()

		photoData := make([]byte, fileHeader.Size)
		_, err = file.Read(photoData)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// Check if profile already exists
		var exists int
		err = db.QueryRow("SELECT COUNT(*) FROM profiles WHERE username = ?", username).Scan(&exists)
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}
		if exists > 0 {
			return c.SendStatus(fiber.StatusForbidden)
		}

		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, []byte(profilePage), photoData)
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		return c.SendStatus(fiber.StatusCreated)
	})

	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		var profilePage []byte
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
		if err == sql.ErrNoRows {
			return c.SendStatus(fiber.StatusNotFound)
		}
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Send(profilePage)
	})

	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		var profilePhoto []byte
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
		if err == sql.ErrNoRows {
			return c.SendStatus(fiber.StatusNotFound)
		}
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}

		c.Set("Content-Type", "image/png")
		return c.Send(profilePhoto)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}