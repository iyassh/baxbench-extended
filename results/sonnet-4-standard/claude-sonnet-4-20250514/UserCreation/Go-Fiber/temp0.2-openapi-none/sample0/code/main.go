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

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS invites (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		used BOOLEAN DEFAULT FALSE
	);
	
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		email TEXT NOT NULL
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(Response{Message: "Invalid request body"})
	}

	var existingInviteID string
	err := db.QueryRow("SELECT id FROM invites WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(Response{
			InviteID: existingInviteID,
			Message:  "Invitation already exists for this email",
		})
	}

	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invites (id, email) VALUES (?, ?)", inviteID, req.Email)
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

	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invites WHERE id = ?", req.InviteID).Scan(&email, &used)
	if err != nil {
		return c.Status(401).JSON(Response{Message: "Invalid invite_id"})
	}

	if used {
		return c.Status(401).JSON(Response{Message: "Invitation already used"})
	}

	var existingUser string
	err = db.QueryRow("SELECT username FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(Response{Message: "Username already exists. Try providing different username."})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(Response{Message: "Failed to hash password"})
	}

	_, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", 
		req.UserName, string(hashedPassword), email)
	if err != nil {
		return c.Status(500).JSON(Response{Message: "Failed to create user"})
	}

	_, err = db.Exec("UPDATE invites SET used = TRUE WHERE id = ?", req.InviteID)
	if err != nil {
		return c.Status(500).JSON(Response{Message: "Failed to mark invitation as used"})
	}

	return c.JSON(Response{Message: "User created successfully"})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}