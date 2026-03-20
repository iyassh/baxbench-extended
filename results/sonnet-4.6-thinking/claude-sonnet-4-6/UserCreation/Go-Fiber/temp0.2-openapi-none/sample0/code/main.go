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

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createInvitationsTable := `
	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT NOT NULL UNIQUE,
		email TEXT NOT NULL UNIQUE
	);`

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_name TEXT NOT NULL UNIQUE,
		password TEXT NOT NULL,
		invite_id TEXT NOT NULL UNIQUE
	);`

	_, err = db.Exec(createInvitationsTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(createUsersTable)
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email is required",
		})
	}

	// Check if email already has an invitation
	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		// Email already invited, return existing invite_id
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email) VALUES (?, ?)", inviteID, req.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to create invitation",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Validate invite_id
	var email string
	err := db.QueryRow("SELECT email FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	// Check if invite_id was already used to create a user
	var existingUser string
	err = db.QueryRow("SELECT user_name FROM users WHERE invite_id = ?", req.InviteID).Scan(&existingUser)
	if err == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	// Check if username already exists
	var existingUserName string
	err = db.QueryRow("SELECT user_name FROM users WHERE user_name = ?", req.UserName).Scan(&existingUserName)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to process password",
		})
	}

	// Create user
	_, err = db.Exec("INSERT INTO users (user_name, password, invite_id) VALUES (?, ?, ?)", req.UserName, string(hashedPassword), req.InviteID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to create user",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "User created successfully",
	})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}