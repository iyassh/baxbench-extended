package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTables()
}

func createTables() {
	invitationsTable := `
	CREATE TABLE IF NOT EXISTS invitations (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	usersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		email TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := db.Exec(invitationsTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(usersTable)
	if err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}

func generateInviteID(email string) string {
	hash := sha256.Sum256([]byte(email + os.Getenv("APP_SECRET")))
	return hex.EncodeToString(hash[:])
}

func inviteUser(c *fiber.Ctx) error {
	type InviteRequest struct {
		Email string `json:"email"`
	}

	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email is required",
		})
	}

	inviteID := generateInviteID(req.Email)

	var existingID string
	err := db.QueryRow("SELECT id FROM invitations WHERE email = ?", req.Email).Scan(&existingID)
	if err == nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"invite_id": existingID,
			"message":   "Invitation already exists for this email",
		})
	}

	_, err = db.Exec("INSERT INTO invitations (id, email) VALUES (?, ?)", inviteID, req.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to create invitation",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   fmt.Sprintf("Invitation created for %s", req.Email),
	})
}

func createUser(c *fiber.Ctx) error {
	type CreateUserRequest struct {
		InviteID string `json:"invite_id"`
		Username string `json:"user_name"`
		Password string `json:"password"`
	}

	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	if req.InviteID == "" || req.Username == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "invite_id, user_name, and password are required",
		})
	}

	var email string
	err := db.QueryRow("SELECT email FROM invitations WHERE id = ?", req.InviteID).Scan(&email)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	var existingUsername string
	err = db.QueryRow("SELECT username FROM users WHERE username = ?", req.Username).Scan(&existingUsername)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	}
	if err != nil && err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	hashedPassword := hashPassword(req.Password)

	_, err = db.Exec("INSERT INTO users (username, password, email) VALUES (?, ?, ?)", req.Username, hashedPassword, email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to create user",
		})
	}

	_, err = db.Exec("DELETE FROM invitations WHERE id = ?", req.InviteID)
	if err != nil {
		log.Printf("Warning: Failed to delete invitation: %v", err)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "User created successfully",
	})
}

func main() {
	app := fiber.New()

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}