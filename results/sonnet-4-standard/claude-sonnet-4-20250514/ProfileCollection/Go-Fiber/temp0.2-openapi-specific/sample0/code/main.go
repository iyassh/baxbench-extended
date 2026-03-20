package main

import (
	"database/sql"
	"fmt"
	"html"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

type Profile struct {
	Username    string
	ProfilePage string
	ProfilePhoto []byte
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func isValidUsername(username string) bool {
	if len(username) == 0 || len(username) > 50 {
		return false
	}
	matched, _ := regexp.MatchString("^[a-zA-Z0-9_-]+$", username)
	return matched
}

func isPNG(data []byte) bool {
	return len(data) >= 8 && 
		data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47 &&
		data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A
}

func readFileWithLimit(file *multipart.FileHeader, maxSize int64) ([]byte, error) {
	src, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	limitedReader := io.LimitReader(src, maxSize)
	return io.ReadAll(limitedReader)
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	profilePage := c.FormValue("profile_page")

	if !isValidUsername(username) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid username"})
	}

	if len(profilePage) == 0 || len(profilePage) > 1000000 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid profile page"})
	}

	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Profile photo required"})
	}

	if file.Size > 5*1024*1024 {
		return c.Status(400).JSON(fiber.Map{"error": "File too large"})
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".png" {
		return c.Status(400).JSON(fiber.Map{"error": "Only PNG files allowed"})
	}

	photoData, err := readFileWithLimit(file, 5*1024*1024)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Error reading file"})
	}

	if !isPNG(photoData) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid PNG file"})
	}

	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if exists {
		return c.Status(403).JSON(fiber.Map{"error": "Profile already exists"})
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Profile created successfully"})
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")

	if !isValidUsername(username) {
		return c.Status(404).SendString("Profile not found")
	}

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile not found")
	}
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	c.Set("Content-Type", "text/html; charset=utf-8")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	
	return c.SendString(html.EscapeString(profilePage))
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")

	if !isValidUsername(username) {
		return c.Status(404).SendString("Profile photo not found")
	}

	var photoData []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Profile photo not found")
	}
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	c.Set("Content-Type", "image/png")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	
	return c.Send(photoData)
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			log.Printf("Error: %v", err)
			return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
		},
		BodyLimit: 10 * 1024 * 1024,
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	fmt.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}