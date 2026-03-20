package main

import (
	"database/sql"
	"io"
	"net/http"
	"regexp"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

const maxUploadSize = 10 * 1024 * 1024 // 10 MB

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page BLOB NOT NULL,
		profile_photo BLOB NOT NULL
	)`)
	if err != nil {
		panic(err)
	}

	app := fiber.New(fiber.Config{
		BodyLimit: maxUploadSize,
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		return c.Next()
	})

	// Validate username: only allow alphanumeric, underscores, hyphens
	usernameRegex := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

	app.Post("/add_profile", func(c *fiber.Ctx) error {
		username := c.FormValue("username")
		if username == "" {
			return c.Status(http.StatusBadRequest).SendString("Missing username")
		}

		if !usernameRegex.MatchString(username) {
			return c.Status(http.StatusBadRequest).SendString("Invalid username")
		}

		profilePage := c.FormValue("profile_page")
		if profilePage == "" {
			return c.Status(http.StatusBadRequest).SendString("Missing profile page")
		}

		fileHeader, err := c.FormFile("profile_photo")
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Missing profile photo")
		}

		if fileHeader.Size > maxUploadSize {
			return c.Status(http.StatusBadRequest).SendString("Profile photo too large")
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Unable to read profile photo")
		}
		defer file.Close()

		photoData, err := io.ReadAll(io.LimitReader(file, maxUploadSize))
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Unable to read profile photo")
		}

		// Validate PNG magic bytes
		if len(photoData) < 8 || string(photoData[:4]) != "\x89PNG" {
			return c.Status(http.StatusBadRequest).SendString("Profile photo must be a valid PNG file")
		}

		// Check if profile already exists using parameterized query
		var exists int
		err = db.QueryRow("SELECT COUNT(*) FROM profiles WHERE username = ?", username).Scan(&exists)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}
		if exists > 0 {
			return c.Status(http.StatusForbidden).SendString("Profile already exists")
		}

		// Insert using parameterized query to prevent SQL injection
		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, []byte(profilePage), photoData)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}

		return c.Status(http.StatusCreated).SendString("Profile created successfully")
	})

	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		if !usernameRegex.MatchString(username) {
			return c.Status(http.StatusBadRequest).SendString("Invalid username")
		}

		var profilePage []byte
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
		if err == sql.ErrNoRows {
			return c.Status(http.StatusNotFound).SendString("Profile not found")
		}
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Send(profilePage)
	})

	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		if !usernameRegex.MatchString(username) {
			return c.Status(http.StatusBadRequest).SendString("Invalid username")
		}

		var profilePhoto []byte
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
		if err == sql.ErrNoRows {
			return c.Status(http.StatusNotFound).SendString("Profile photo not found")
		}
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Internal server error")
		}

		c.Set("Content-Type", "image/png")
		return c.Send(profilePhoto)
	})

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}