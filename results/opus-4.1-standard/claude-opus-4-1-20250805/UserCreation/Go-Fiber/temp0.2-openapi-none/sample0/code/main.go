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

type InviteUserRequest struct {
	Email string `json:"email"`
}

type InviteUserResponse struct {
	InviteID string `json:"invite_id"`
	Message  string `json:"message"`
}

type CreateUserRequest struct {
	InviteID string `json:"invite_id"`
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		email TEXT UNIQUE NOT NULL
	);

	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
		used BOOLEAN DEFAULT FALSE,
		created_by INTEGER,
		FOREIGN KEY (created_by) REFERENCES users(id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}

	// Create initial admin user if no users exist
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		log.Fatal(err)
	}

	if count == 0 {
		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
		_, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
			"admin", string(hashedPassword), "admin@example.com")
		if err != nil {
			log.Fatal(err)
		}
	}
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid request body"})
	}

	// Check if invitation already exists for this email
	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(InviteUserResponse{
			InviteID: existingInviteID,
			Message:  "Invitation already exists for this email",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email, created_by) VALUES (?, ?, ?)",
		inviteID, req.Email, 1) // Using 1 as default creator ID for simplicity
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to create invitation"})
	}

	return c.JSON(InviteUserResponse{
		InviteID: inviteID,
		Message:  "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid request body"})
	}

	// Validate invitation
	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
	if err != nil {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid invite_id"})
	}

	if used {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid invite_id"})
	}

	// Check if username already exists
	var existingUser int
	err = db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil && existingUser > 0 {
		return c.Status(400).JSON(MessageResponse{Message: "Username already exists. Try providing different username."})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to process password"})
	}

	// Create user
	_, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
		req.UserName, string(hashedPassword), email)
	if err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Failed to create user"})
	}

	// Mark invitation as used
	_, err = db.Exec("UPDATE invitations SET used = TRUE WHERE invite_id = ?", req.InviteID)
	if err != nil {
		log.Printf("Failed to mark invitation as used: %v", err)
	}

	return c.JSON(MessageResponse{Message: "User created successfully"})
}

func main() {
	// Get app secret from environment
	_ = os.Getenv("APP_SECRET")

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}