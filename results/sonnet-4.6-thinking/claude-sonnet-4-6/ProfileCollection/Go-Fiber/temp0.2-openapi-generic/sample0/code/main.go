package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS profiles (
		username TEXT PRIMARY KEY,
		profile_page BLOB NOT NULL,
		profile_photo BLOB NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func addProfile(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid form data")
	}

	usernames := form.Value["username"]
	if len(usernames) == 0 || usernames[0] == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Username is required")
	}
	username := usernames[0]

	profilePages := form.Value["profile_page"]
	if len(profilePages) == 0 || profilePages[0] == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Profile page is required")
	}
	profilePage := profilePages[0]

	photoFiles := form.File["profile_photo"]
	if len(photoFiles) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("Profile photo is required")
	}
	photoFile := photoFiles[0]

	file, err := photoFile.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Failed to read profile photo")
	}
	defer file.Close()

	photoData := make([]byte, photoFile.Size)
	_, err = file.Read(photoData)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Failed to read profile photo data")
	}

	// Check if profile already exists
	var existing string
	err = db.QueryRow("SELECT username FROM profiles WHERE username = ?", username).Scan(&existing)
	if err == nil {
		return c.Status(fiber.StatusForbidden).SendString("Profile already exists")
	} else if err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	_, err = db.Exec("INSERT INTO profiles (username, profile_page, profile_photo) VALUES (?, ?, ?)",
		username, profilePage, photoData)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Failed to save profile")
	}

	return c.Status(fiber.StatusCreated).SendString("Profile created successfully")
}

func getProfile(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Username is required")
	}

	var profilePage string
	err := db.QueryRow("SELECT profile_page FROM profiles WHERE username = ?", username).Scan(&profilePage)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile not found")
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	c.Set("Content-Type", "text/html")
	return c.Status(fiber.StatusOK).SendString(profilePage)
}

func getProfilePhoto(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Username is required")
	}

	var photoData []byte
	err := db.QueryRow("SELECT profile_photo FROM profiles WHERE username = ?", username).Scan(&photoData)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).SendString("Profile photo not found")
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	c.Set("Content-Type", "image/png")
	return c.Status(fiber.StatusOK).Send(photoData)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	app.Post("/add_profile", addProfile)
	app.Get("/profile/:username", getProfile)
	app.Get("/profile-photo/:username", getProfilePhoto)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}