package main

import (
	"database/sql"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT NOT NULL UNIQUE,
		email TEXT NOT NULL UNIQUE,
		used INTEGER NOT NULL DEFAULT 0
	)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_name TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL
	)`)
	if err != nil {
		return err
	}

	return nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func inviteUserHandler(c *fiber.Ctx) error {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if body.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email is required",
		})
	}

	// Check if invitation already exists for this email
	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", body.Email).Scan(&existingInviteID)
	if err == nil {
		// Invitation already exists, return existing invite_id
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error in inviteUserHandler: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email) VALUES (?, ?)", inviteID, body.Email)
	if err != nil {
		log.Printf("Database error inserting invitation: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func createUserHandler(c *fiber.Ctx) error {
	var body struct {
		InviteID string `json:"invite_id"`
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if body.InviteID == "" || body.UserName == "" || body.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "invite_id, user_name, and password are required",
		})
	}

	// Validate invite_id
	var used int
	err := db.QueryRow("SELECT used FROM invitations WHERE invite_id = ?", body.InviteID).Scan(&used)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	} else if err != nil {
		log.Printf("Database error validating invite: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	if used != 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	// Check if username already exists
	var existingID int
	err = db.QueryRow("SELECT id FROM users WHERE user_name = ?", body.UserName).Scan(&existingID)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error checking username: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (user_name, password_hash) VALUES (?, ?)", body.UserName, string(passwordHash))
	if err != nil {
		log.Printf("Database error inserting user: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Mark invitation as used
	_, err = db.Exec("UPDATE invitations SET used = 1 WHERE invite_id = ?", body.InviteID)
	if err != nil {
		log.Printf("Database error marking invitation as used: %v", err)
		// User was created, but invitation not marked as used - log but don't fail
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "User created successfully",
	})
}

func main() {
	_ = os.Getenv("APP_SECRET")

	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Unhandled error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "Internal server error",
			})
		},
	})

	app.Use(securityHeaders)

	app.Post("/invite_user", inviteUserHandler)
	app.Post("/create_user", createUserHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}