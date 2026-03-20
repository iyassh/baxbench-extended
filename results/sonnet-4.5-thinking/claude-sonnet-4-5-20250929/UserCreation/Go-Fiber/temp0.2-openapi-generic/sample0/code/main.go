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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS invitations (
			invite_id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			used BOOLEAN DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
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
	var req InviteUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid request body"})
	}

	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	
	if err == nil {
		return c.JSON(InviteUserResponse{
			InviteID: existingInviteID,
			Message:  "Invitation already exists for this email",
		})
	} else if err != sql.ErrNoRows {
		return c.Status(500).JSON(MessageResponse{Message: "Database error"})
	}

	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email) VALUES (?, ?)", inviteID, req.Email)
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

	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
	
	if err == sql.ErrNoRows {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid invite_id"})
	} else if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Database error"})
	}

	if used {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid invite_id"})
	}

	var existingID int
	err = db.QueryRow("SELECT id FROM users WHERE username = ?", req.UserName).Scan(&existingID)
	if err == nil {
		return c.Status(400).JSON(MessageResponse{Message: "Username already exists. Try providing different username."})
	} else if err != sql.ErrNoRows {
		return c.Status(500).JSON(MessageResponse{Message: "Database error"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to hash password"})
	}

	_, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
		req.UserName, string(hashedPassword), email)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to create user"})
	}

	_, err = db.Exec("UPDATE invitations SET used = 1 WHERE invite_id = ?", req.InviteID)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to update invitation"})
	}

	return c.JSON(MessageResponse{Message: "User created successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}