package main

import (
	"database/sql"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page BLOB NOT NULL,
		profile_photo BLOB NOT NULL
	)`)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit:             5 * 1024 * 1024, // 5MB limit
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString(http.StatusText(code))
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	// Rate limiting
	app.Use(limiter.New(limiter.Config{
		Max:        60,
		Expiration: 60,
	}))

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Username is required")
	}

	// Validate username length
	if len(username) > 64 {
		return c.Status(fiber.StatusBadRequest).SendString("Username too long")
	}

	// Get profile page content
	profilePage := c.FormValue("profile_page")
	if profilePage == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Profile page is required")
	}

	// Limit profile page size
	if len(profilePage) > 1*1024*1024 {
		return c.Status(fiber.StatusBadRequest).SendString("Profile page content too large")
	}

	// Get profile photo
	photoFile, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo is required")
	}

	// Limit photo size
	if photoFile.Size > 2*1024*1024 {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo too large")
	}

	// Read photo bytes
	file, err := photoFile.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to read profile photo")
	}
	defer file.Close()

	photoBytes := make([]byte, photoFile.Size)
	if _, err := file.Read(photoBytes); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to read profile photo")
	}

	// Validate PNG magic bytes
	if len(photoBytes) < 8 ||
		photoBytes[0] != 0x89 || photoBytes[1] != 0x50 ||
		photoBytes[2] != 0x4E || photoBytes[3] != 0x47 ||
		photoBytes[4] != 0x0D || photoBytes[5] != 0x0A ||
		photoBytes[6] != 0x1A || photoBytes[7] != 0x0A {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo must be a valid PNG image")
	}

	// Check if profile already exists using parameterized query
	var exists int
	err = db.QueryRow("SELECT COUNT(*) FROM profiles WHERE username = ?", username).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}
	if exists > 0 {
		return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
	}

	// Insert profile using parameterized query
	_, err = db.Exec(
		"INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoBytes,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to create profile")
	}

	return c.Status(fiber.StatusCreated).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Username is required")
	}

	var profilePage []byte
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile not found")
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	// Override CSP for profile page to allow inline content but still restrict dangerous features
	c.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox allow-same-origin")
	c.Set("Content-Type", "text/html; charset=utf-8")
	// Serve the raw HTML as stored - it's user-provided content served in its own context
	return c.Status(fiber.StatusOK).Send(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Username is required")
	}

	var profilePhoto []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	c.Set("Content-Type", "image/png")
	c.Set("Content-Security-Policy", "default-src 'none'")
	return c.Status(fiber.StatusOK).Send(profilePhoto)
}