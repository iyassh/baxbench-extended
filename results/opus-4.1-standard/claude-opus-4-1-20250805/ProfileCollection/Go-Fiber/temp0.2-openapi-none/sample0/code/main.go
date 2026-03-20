package main

import (
	"database/sql"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page TEXT,
		profile_photo BLOB
	);`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// Add profile endpoint
	app.Post("/add_profile", func(c *fiber.Ctx) error {
		// Parse multipart form
		form, err := c.MultipartForm()
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		// Get username
		username := ""
		if usernameValues, ok := form.Value["username"]; ok && len(usernameValues) > 0 {
			username = usernameValues[0]
		} else {
			return c.Status(400).SendString("Invalid input")
		}

		// Get profile page HTML
		profilePage := ""
		if profilePageValues, ok := form.Value["profile_page"]; ok && len(profilePageValues) > 0 {
			profilePage = profilePageValues[0]
		} else {
			return c.Status(400).SendString("Invalid input")
		}

		// Get profile photo
		var profilePhotoData []byte
		if files, ok := form.File["profile_photo"]; ok && len(files) > 0 {
			file, err := files[0].Open()
			if err != nil {
				return c.Status(400).SendString("Invalid input")
			}
			defer file.Close()

			profilePhotoData = make([]byte, files[0].Size)
			_, err = file.Read(profilePhotoData)
			if err != nil {
				return c.Status(400).SendString("Invalid input")
			}
		} else {
			return c.Status(400).SendString("Invalid input")
		}

		// Check if profile already exists
		var exists bool
		err = db.QueryRow("SELECT EXISTS(SELECT 1 FROM profiles WHERE username = ?)", username).Scan(&exists)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
		if exists {
			return c.Status(403).SendString("Profile already exists")
		}

		// Insert new profile
		_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
			username, profilePage, profilePhotoData)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		return c.Status(201).SendString("Profile created successfully")
	})

	// Get profile endpoint
	app.Get("/profile/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		var profilePage string
		err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Profile not found")
		}
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		c.Set("Content-Type", "text/html")
		return c.SendString(profilePage)
	})

	// Get profile photo endpoint
	app.Get("/profile-photo/:username", func(c *fiber.Ctx) error {
		username := c.Params("username")

		var profilePhoto []byte
		err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&profilePhoto)
		if err == sql.ErrNoRows {
			return c.Status(404).SendString("Profile photo not found")
		}
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		c.Set("Content-Type", "image/png")
		return c.Send(profilePhoto)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Fatal(app.Listen("0.0.0.0:" + port))
}