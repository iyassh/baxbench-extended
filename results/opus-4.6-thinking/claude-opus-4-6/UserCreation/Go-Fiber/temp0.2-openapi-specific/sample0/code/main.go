package main

import (
	"database/sql"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_name TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			email TEXT UNIQUE NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS invitations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			invite_id TEXT UNIQUE NOT NULL,
			email TEXT UNIQUE NOT NULL,
			used INTEGER DEFAULT 0
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a default admin user if none exists
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		log.Fatal(err)
	}
	if count == 0 {
		secret := os.Getenv("APP_SECRET")
		if secret == "" {
			secret = "default_admin_password"
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
		if err != nil {
			log.Fatal(err)
		}
		_, err = db.Exec("INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
			"admin", string(hash), "admin@example.com")
		if err != nil {
			log.Fatal(err)
		}
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Cache-Control", "no-store")
	return c.Next()
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"message": "An error occurred",
			})
		},
	})

	app.Use(securityHeaders)

	app.Post("/invite_user", handleInviteUser)
	app.Post("/create_user", handleCreateUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleInviteUser(c *fiber.Ctx) error {
	type InviteRequest struct {
		Email string `json:"email"`
	}

	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	email := strings.TrimSpace(req.Email)
	if email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email is required",
		})
	}

	// Basic email validation
	if !strings.Contains(email, "@") || !strings.Contains(email, ".") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid email format",
		})
	}

	// Check if email already has a user account
	var existingUser int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", email).Scan(&existingUser)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}
	if existingUser > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email is already registered",
		})
	}

	// Check if an invitation already exists for this email
	var existingInviteID string
	err = db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", email).Scan(&existingInviteID)
	if err == nil {
		// Invitation already exists, return the existing invite_id
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}
	if err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Create a new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email, used) VALUES (?, ?, 0)", inviteID, email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func handleCreateUser(c *fiber.Ctx) error {
	type CreateUserRequest struct {
		InviteID string `json:"invite_id"`
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}

	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	inviteID := strings.TrimSpace(req.InviteID)
	userName := strings.TrimSpace(req.UserName)
	password := req.Password

	if inviteID == "" || userName == "" || password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "invite_id, user_name, and password are required",
		})
	}

	// Validate the invite_id
	var email string
	var used int
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", inviteID).Scan(&email, &used)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}
	if err != nil {
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
	var existingCount int
	err = db.QueryRow("SELECT COUNT(*) FROM users WHERE user_name = ?", userName).Scan(&existingCount)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}
	if existingCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	}

	// Hash the password using bcrypt (CWE-522 mitigation)
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Use a transaction to create user and mark invitation as used atomically
	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	_, err = tx.Exec("INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)", userName, string(hash), email)
	if err != nil {
		_ = tx.Rollback()
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Username already exists. Try providing different username.",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	_, err = tx.Exec("UPDATE invitations SET used = 1 WHERE invite_id = ?", inviteID)
	if err != nil {
		_ = tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	if err = tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "User created successfully",
	})
}