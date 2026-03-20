<CODE>
package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

const (
	maxFileSize      = 10 * 1024 * 1024 // 10MB
	maxHTMLSize      = 1 * 1024 * 1024  // 1MB
	maxUsernameLen   = 50
	dbPath           = "db.sqlite3"
)

var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type Profile struct {
	Username     string
	ProfilePage  []byte
	ProfilePhoto []byte
}

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page BLOB NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func validateUsername(username string) error {
	if username == "" {
		return fmt.Errorf("username cannot be empty")
	}
	if len(username) > maxUsernameLen {
		return fmt.Errorf("username too long")
	}
	if !usernameRegex.MatchString(username) {
		return fmt.Errorf("username contains invalid characters")
	}
	return nil
}

func validatePNG(data []byte) error {
	if len(data) < 8 {
		return fmt.Errorf("invalid PNG file")
	}
	pngHeader := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	for i := 0; i < 8; i++ {
		if data[i] != pngHeader[i] {
			return fmt.Errorf("invalid PNG file")
		}
	}
	return nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func main() {
	db, err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit:             maxFileSize,
		DisableStartupMessage: false,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal Server Error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				message = e.Message
			}

			c.Set(fiber.HeaderContentType, fiber.MIMETextPlainCharsetUTF8)
			return c.Status(code).SendString(message)
		},
	})

	app.Use(securityHeaders)

	app.Post("/add_profile", func(c *fiber.Ctx) error {
		username := c.FormValue("username")
		
		if err := validateUsername(username); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid username")
		}

		var exists int
		err := db.QueryRow("SELECT 1 FROM profiles WHERE username = ?", username).Scan(&exists)
		if err == nil {
			return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
		} else if err != sql.ErrNoRows {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		profilePage := c.FormValue("profile_page")
		if profilePage == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}
		if len(profilePage) > maxHTMLSize {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		fileHeader, err := c.FormFile("profile_photo")
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if fileHeader.Size > maxFileSize {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
		if ext != ".png" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		file, err := fileHeader.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}
		defer file.Close()

		photoData := make([]byte, fileHeader.Size)
		_, err = file.Read(photoData)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if err := validatePNG(photoData); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, []byte(profilePage), photoData)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		return c.Status(fiber.StatusCreated).SendString("Profile created successfully")
	})

	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		
		if err := validateUsername(username); err != nil {
			return c.Status(fiber.StatusNotFound).SendString("Profile not found")
		}

		var profilePage []byte
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).SendString("Profile not found")
		} else if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		c.Set(fiber.HeaderContentType, fiber.MIMETextHTMLCharsetUTF8)
		c.Set("X-Content-Type-Options", "nosniff")
		
		escapedUsername := html.EscapeString(username)
		safeHTML := fmt.Sprintf("<!-- Profile for user: %s -->\n%s", escapedUsername, string(profilePage))
		
		return c.SendString(safeHTML)
	})

	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")
		
		if err := validateUsername(username); err != nil {
			return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
		}

		var profilePhoto []byte
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
		} else if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		c.Set(fiber.HeaderContentType, "image/png")
		c.Set("X-Content-Type-Options", "nosniff")
		return c.Send(profilePhoto)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>