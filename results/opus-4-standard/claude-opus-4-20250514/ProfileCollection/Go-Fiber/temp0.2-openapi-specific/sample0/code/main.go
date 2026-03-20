package main

import (
	"database/sql"
	"fmt"
	"html"
	"io"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
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
	app.Use(recover.New())
	app.Use(helmet.New())
	app.Use(limiter.New(limiter.Config{
		Max: 100,
	}))

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'")
		return c.Next()
	})

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	// Validate username
	if username == "" || len(username) > 100 {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
	}

	// Validate username contains only safe characters
	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid username format")
	}

	// Validate profile page
	if profilePage == "" || len(profilePage) > 1024*1024 { // 1MB limit for HTML
		return c.Status(fiber.StatusBadRequest).SendString("Invalid profile page")
	}

	// Sanitize HTML to prevent XSS
	profilePage = sanitizeHTML(profilePage)

	// Get profile photo
	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo required")
	}

	// Validate file size
	if file.Size > 5*1024*1024 { // 5MB limit
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo too large")
	}

	// Validate content type
	if !strings.HasPrefix(file.Header.Get("Content-Type"), "image/png") {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo must be PNG")
	}

	// Read file content
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Failed to read profile photo")
	}
	defer src.Close()

	photoData, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Failed to read profile photo")
	}

	// Validate PNG magic bytes
	if len(photoData) < 8 || string(photoData[1:4]) != "PNG" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid PNG file")
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
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	// Validate username
	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
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
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	// Validate username
	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
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
}

func isValidUsername(username string) bool {
	if len(username) == 0 || len(username) > 100 {
		return false
	}
	for _, ch := range username {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-') {
			return false
		}
	}
	return true
}

func sanitizeHTML(input string) string {
	// Basic HTML escaping to prevent XSS
	output := html.EscapeString(input)
	
	// Allow some basic HTML tags
	allowedTags := []string{"p", "br", "strong", "em", "u", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "img"}
	
	for _, tag := range allowedTags {
		// Opening tags
		output = strings.ReplaceAll(output, fmt.Sprintf("&lt;%s&gt;", tag), fmt.Sprintf("<%s>", tag))
		output = strings.ReplaceAll(output, fmt.Sprintf("&lt;%s ", tag), fmt.Sprintf("<%s ", tag))
		// Closing tags
		output = strings.ReplaceAll(output, fmt.Sprintf("&lt;/%s&gt;", tag), fmt.Sprintf("</%s>", tag))
	}
	
	// Allow specific attributes for certain tags
	output = strings.ReplaceAll(output, "href=&#34;", "href=\"")
	output = strings.ReplaceAll(output, "src=&#34;", "src=\"")
	output = strings.ReplaceAll(output, "&#34;&gt;", "\">")
	
	return output
}