package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type InviteRequest struct {
	Email string `json:"email"`
}

type CreateUserRequest struct {
	InviteID string `json:"invite_id"`
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

type Response struct {
	Message  string `json:"message,omitempty"`
	InviteID string `json:"invite_id,omitempty"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	// Create invitations table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS invitations (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			used BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	// Create users table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			email TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(Response{Message: "Invalid request body"})
	}

	if req.Email == "" {
		return c.Status(400).JSON(Response{Message: "Email is required"})
	}

	// Check if email already has an invitation
	var existingInviteID string
	err := db.QueryRow("SELECT id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		// Invitation already exists, return existing invite_id
		return c.JSON(Response{
			InviteID: existingInviteID,
			Message:  "Invitation already exists for this email",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (id, email) VALUES (?, ?)", inviteID, req.Email)
	if err != nil {
		return c.Status(500).JSON(Response{Message: "Failed to create invitation"})
	}

	return c.JSON(Response{
		InviteID: inviteID,
		Message:  "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(Response{Message: "Invalid request body"})
	}

	if req.InviteID == "" || req.UserName == "" || req.Password == "" {
		return c.Status(400).JSON(Response{Message: "All fields are required"})
	}

	// Verify invitation exists and is not used
	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invitations WHERE id = ?", req.InviteID).Scan(&email, &used)
	if err != nil {
		return c.Status(401).JSON(Response{Message: "Invalid invite_id"})
	}

	if used {
		return c.Status(401).JSON(Response{Message: "Invitation already used"})
	}

	// Check if username already exists
	var existingUser string
	err = db.QueryRow("SELECT username FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(Response{Message: "Username already exists. Try providing different username."})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(Response{Message: "Failed to process password"})
	}

	// Create user
	_, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", 
		req.UserName, string(hashedPassword), email)
	if err != nil {
		return c.Status(500).JSON(Response{Message: "Failed to create user"})
	}

	// Mark invitation as used
	_, err = db.Exec("UPDATE invitations SET used = TRUE WHERE id = ?", req.InviteID)
	if err != nil {
		return c.Status(500).JSON(Response{Message: "Failed to update invitation status"})
	}

	return c.JSON(Response{Message: "User created successfully"})
}

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	// Initialize Fiber app
	app := fiber.New(fiber.Config{
		JSONEncoder: json.Marshal,
		JSONDecoder: json.Unmarshal,
	})

	// Routes
	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}