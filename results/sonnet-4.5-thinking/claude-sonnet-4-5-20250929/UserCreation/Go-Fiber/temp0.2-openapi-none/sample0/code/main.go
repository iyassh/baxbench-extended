package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func main() {
	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables
	createTables()

	// Initialize Fiber app
	app := fiber.New()

	// Routes
	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables() {
	// Create invitations table
	invitationsTable := `
	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		invite_id TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err := db.Exec(invitationsTable)
	if err != nil {
		log.Fatal(err)
	}

	// Create users table
	usersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		email TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(usersTable)
	if err != nil {
		log.Fatal(err)
	}
}

func inviteUser(c *fiber.Ctx) error {
	type Request struct {
		Email string `json:"email"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Check if invitation already exists for this email
	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	
	if err == nil {
		// Invitation already exists, return existing invite_id
		return c.JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (email, invite_id) VALUES (?, ?)", req.Email, inviteID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Failed to create invitation",
		})
	}

	return c.JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	type Request struct {
		InviteID string `json:"invite_id"`
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Verify invite_id exists and get the email
	var email string
	err := db.QueryRow("SELECT email FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	// Check if username already exists
	var existingUsername string
	err = db.QueryRow("SELECT username FROM users WHERE username = ?", req.UserName).Scan(&existingUsername)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Failed to hash password",
		})
	}

	// Create user
	_, err = db.Exec("INSERT INTO users (username, password, email) VALUES (?, ?, ?)", 
		req.UserName, string(hashedPassword), email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Failed to create user",
		})
	}

	return c.JSON(fiber.Map{
		"message": "User created successfully",
	})
}