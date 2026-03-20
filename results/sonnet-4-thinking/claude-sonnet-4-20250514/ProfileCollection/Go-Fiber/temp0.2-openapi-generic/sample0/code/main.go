package main

import (
	"database/sql"
	"io"
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDatabase() error {
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

func isValidUsername(username string) bool {
	// Only allow alphanumeric characters and underscores, 3-50 characters
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9_]{3,50}$`, username)
	return matched
}

func isPNG(data []byte) bool {
	// Check PNG magic bytes
	return len(data) >= 8 &&
		data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 &&
		data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A
}

func sanitizeHTML(html string) string {
	// Basic HTML sanitization - remove script tags and dangerous attributes
	html = regexp.MustCompile(`(?i)<script[^>]*>.*?</script>`).ReplaceAllString(html, "")
	html = regexp.MustCompile(`(?i)on\w+\s*=\s*"[^"]*"`).ReplaceAllString(html, "")
	html = regexp.MustCompile(`(?i)on\w+\s*=\s*'[^']*'`).ReplaceAllString(html, "")
	html = regexp.MustCompile(`(?i)javascript:`).ReplaceAllString(html, "")
	return html
}

func addProfileHandler(c *fiber.Ctx) error {
	// Parse multipart form
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid form data")
	}

	// Get username
	usernames := form.Value["username"]
	if len(usernames) == 0 || len(usernames[0]) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("Username is required")
	}
	username := strings.TrimSpace(usernames[0])

	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid username format")
	}

	// Get profile page HTML
	profilePages := form.Value["profile_page"]
	if len(profilePages) == 0 || len(profilePages[0]) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("Profile page is required")
	}
	profilePage := sanitizeHTML(profilePages[0])

	// Get profile photo
	files := form.File["profile_photo"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo is required")
	}

	file := files[0]
	if file.Size > 5*1024*1024 { // 5MB limit
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo too large")
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Cannot open profile photo")
	}
	defer src.Close()

	photoData, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Cannot read profile photo")
	}

	if !isPNG(photoData) {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo must be PNG format")
	}

	// Check if profile already exists
	var existingUsername string
	err = db.QueryRow("SELECT username FROM profiles WHERE username = ?", username).Scan(&existingUsername)
	if err == nil {
		return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
	} else if err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	// Insert profile
	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to create profile")
	}

	return c.Status(fiber.StatusCreated).SendString("Profile created successfully")
}

func getProfileHandler(c *fiber.Ctx) error {
	username := c.Params("username")
	if !isValidUsername(username) {
		return c.Status(fiber.StatusNotFound).SendString("Profile not found")
	}

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile not found")
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	c.Set("Content-Type", "text/html")
	return c.SendString(profilePage)
}

func getProfilePhotoHandler(c *fiber.Ctx) error {
	username := c.Params("username")
	if !isValidUsername(username) {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	}

	var profilePhoto []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	c.Set("Content-Type", "image/png")
	return c.Send(profilePhoto)
}

func main() {
	err := initDatabase()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/add_profile", addProfileHandler)
	app.Get("/profile/:username", getProfileHandler)
	app.Get("/profile-photo/:username", getProfilePhotoHandler)

	log.Println("Server starting on port 5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}