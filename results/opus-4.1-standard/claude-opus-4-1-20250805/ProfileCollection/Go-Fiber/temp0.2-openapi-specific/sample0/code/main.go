package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTableQuery)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString("An error occurred")
		},
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())
	app.Use(limiter.New(limiter.Config{
		Max: 100,
	}))

	// Add security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'")
		return c.Next()
	})

	app.Post("/add_profile", func(c *fiber.Ctx) error {
		username := c.FormValue("username")
		if username == "" || len(username) > 100 {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
		}

		// Validate username contains only safe characters
		for _, ch := range username {
			if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
				return c.Status(fiber.StatusBadRequest).SendString("Invalid username characters")
			}
		}

		profilePage := c.FormValue("profile_page")
		if profilePage == "" || len(profilePage) > 1024*1024 { // 1MB limit for HTML
			return c.Status(fiber.StatusBadRequest).SendString("Invalid profile page")
		}

		fileHeader, err := c.FormFile("profile_photo")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid profile photo")
		}

		if fileHeader.Size > 5*1024*1024 { // 5MB limit for photo
			return c.Status(fiber.StatusBadRequest).SendString("Profile photo too large")
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid profile photo")
		}
		defer file.Close()

		// Read file content
		photoData := make([]byte, fileHeader.Size)
		_, err = file.Read(photoData)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid profile photo")
		}

		// Check if PNG by verifying magic bytes
		if len(photoData) < 8 || string(photoData[1:4]) != "PNG" {
			return c.Status(fiber.StatusBadRequest).SendString("Profile photo must be PNG")
		}

		// Check if profile already exists
		var exists bool
		err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database error")
		}

		if exists {
			return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
		}

		// Insert profile
		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, profilePage, photoData)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to create profile")
		}

		return c.SendStatus(fiber.StatusCreated)
	})

	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		if username == "" || len(username) > 100 {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
		}

		// Validate username contains only safe characters
		for _, ch := range username {
			if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
				return c.Status(fiber.StatusBadRequest).SendString("Invalid username characters")
			}
		}

		var profilePage string
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).SendString("Profile not found")
		}
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database error")
		}

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(profilePage)
	})

	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		if username == "" || len(username) > 100 {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
		}

		// Validate username contains only safe characters
		for _, ch := range username {
			if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
				return c.Status(fiber.StatusBadRequest).SendString("Invalid username characters")
			}
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
		return c.Send(profilePhoto)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Fatal(app.Listen(fmt.Sprintf("0.0.0.0:%s", port)))
}