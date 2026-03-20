package main

import (
	"database/sql"
	"io"
	"log"
	"net/http"
	"regexp"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

// Maximum sizes for uploads
const (
	maxProfilePageSize  = 1 * 1024 * 1024  // 1 MB
	maxProfilePhotoSize = 5 * 1024 * 1024   // 5 MB
	maxBodySize         = 10 * 1024 * 1024   // 10 MB
)

var validUsername = regexp.MustCompile(`^[a-zA-Z0-9_\-]{1,64}$`)

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page BLOB NOT NULL,
		profile_photo BLOB NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Missing username")
	}

	if !validUsername.MatchString(username) {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
	}

	// Check if profile already exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM profiles WHERE username = ?", username).Scan(&exists)
	if err != nil {
		log.Println("Database error during existence check")
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}
	if exists > 0 {
		return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
	}

	// Get profile_page file
	profilePageHeader, err := c.FormFile("profile_page")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Missing profile_page")
	}
	if profilePageHeader.Size > maxProfilePageSize {
		return c.Status(fiber.StatusBadRequest).SendString("Profile page too large")
	}

	profilePageFile, err := profilePageHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Cannot read profile_page")
	}
	defer profilePageFile.Close()

	profilePageData, err := io.ReadAll(io.LimitReader(profilePageFile, maxProfilePageSize+1))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Cannot read profile_page")
	}
	if int64(len(profilePageData)) > maxProfilePageSize {
		return c.Status(fiber.StatusBadRequest).SendString("Profile page too large")
	}

	// Get profile_photo file
	profilePhotoHeader, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Missing profile_photo")
	}
	if profilePhotoHeader.Size > maxProfilePhotoSize {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo too large")
	}

	profilePhotoFile, err := profilePhotoHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Cannot read profile_photo")
	}
	defer profilePhotoFile.Close()

	profilePhotoData, err := io.ReadAll(io.LimitReader(profilePhotoFile, maxProfilePhotoSize+1))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Cannot read profile_photo")
	}
	if int64(len(profilePhotoData)) > maxProfilePhotoSize {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo too large")
	}

	// Validate PNG signature
	if len(profilePhotoData) < 8 {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid PNG file")
	}
	pngSignature := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	for i := 0; i < 8; i++ {
		if profilePhotoData[i] != pngSignature[i] {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid PNG file")
		}
	}

	// Detect content type of profile page to ensure it's HTML-like
	contentType := http.DetectContentType(profilePageData)
	_ = contentType // We accept the HTML as-is but serve it with CSP headers

	// Insert into database using parameterized query
	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePageData, profilePhotoData)
	if err != nil {
		log.Println("Database error during insert")
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}

	return c.Status(fiber.StatusCreated).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")
	if !validUsername.MatchString(username) {
		return c.Status(fiber.StatusNotFound).SendString("Profile not found")
	}

	var profilePage []byte
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile not found")
	}
	if err != nil {
		log.Println("Database error during profile retrieval")
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(fiber.StatusOK).Send(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")
	if !validUsername.MatchString(username) {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	}

	var profilePhoto []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	}
	if err != nil {
		log.Println("Database error during photo retrieval")
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}

	c.Set("Content-Type", "image/png")
	return c.Status(fiber.StatusOK).Send(profilePhoto)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit:             maxBodySize,
		DisableStartupMessage: false,
	})

	// Apply security headers middleware
	app.Use(securityHeaders)

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}