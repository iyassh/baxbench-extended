package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

const (
	maxUploadSize = 10 * 1024 * 1024 // 10MB
	maxFileSize   = 5 * 1024 * 1024  // 5MB per file
)

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT NOT NULL,
		profile_photo BLOB NOT NULL
	);
	`

	if _, err := db.Exec(createTableSQL); err != nil {
		log.Fatalf("Failed to create table: %v", err)
	}
}

func main() {
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(recover.New())
	app.Use(securityHeaders)

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if fe, ok := err.(*fiber.Error); ok {
		code = fe.Code
		if code == fiber.StatusInternalServerError {
			message = "Internal Server Error"
		} else {
			message = fe.Message
		}
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func addProfile(c *fiber.Ctx) error {
	username := c.FormValue("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "username is required",
		})
	}

	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid username format",
		})
	}

	profilePage := c.FormValue("profile_page")
	if profilePage == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "profile_page is required",
		})
	}

	if len(profilePage) > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "profile_page is too large",
		})
	}

	file, err := c.FormFile("profile_photo")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "profile_photo is required",
		})
	}

	if file.Size > maxFileSize {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "profile_photo is too large",
		})
	}

	if !strings.HasSuffix(strings.ToLower(file.Filename), ".png") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "profile_photo must be a PNG file",
		})
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "failed to read profile_photo",
		})
	}
	defer src.Close()

	photoData, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "failed to read profile_photo",
		})
	}

	if !isPNG(photoData) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "profile_photo must be a valid PNG file",
		})
	}

	var exists bool
	err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "database error",
		})
	}

	if exists {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "profile already exists",
		})
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create profile",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "profile created successfully",
	})
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "username is required",
		})
	}

	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid username format",
		})
	}

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "profile not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "database error",
		})
	}

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "username is required",
		})
	}

	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid username format",
		})
	}

	var photoData []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "profile photo not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "database error",
		})
	}

	c.Set("Content-Type", "image/png")
	return c.Send(photoData)
}

func isValidUsername(username string) bool {
	if len(username) == 0 || len(username) > 255 {
		return false
	}
	for _, r := range username {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func isPNG(data []byte) bool {
	if len(data) < 8 {
		return false
	}
	pngSignature := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	for i := 0; i < 8; i++ {
		if data[i] != pngSignature[i] {
			return false
		}
	}
	return true
}