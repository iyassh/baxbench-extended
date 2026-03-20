package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	app := fiber.New()

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("username is required")
	}

	profilePage := c.FormValue("profile_page")
	if profilePage == "" {
		return c.Status(fiber.StatusBadRequest).SendString("profile_page is required")
	}

	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("profile_photo is required")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("failed to open profile_photo")
	}
	defer src.Close()

	photoData, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("failed to read profile_photo")
	}

	var existingUsername string
	err = db.QueryRow("SELECT username FROM profiles WHERE username = ?", username).Scan(&existingUsername)
	if err == nil {
		return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
	}
	if err != sql.ErrNoRows {
		return c.Status(fiber.StatusBadRequest).SendString("database error")
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("failed to insert profile")
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
		return c.Status(fiber.StatusBadRequest).SendString("database error")
	}

	c.Set("Content-Type", "text/html")
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	var photoData []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	}
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("database error")
	}

	c.Set("Content-Type", "image/png")
	return c.Send(photoData)
}