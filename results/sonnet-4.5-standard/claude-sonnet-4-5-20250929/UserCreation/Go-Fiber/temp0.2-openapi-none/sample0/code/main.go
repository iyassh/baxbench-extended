<CODE>
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

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTables()

	app := fiber.New()

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables() {
	invitesTable := `
	CREATE TABLE IF NOT EXISTS invites (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		used INTEGER DEFAULT 0
	);`

	usersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		email TEXT UNIQUE NOT NULL
	);`

	_, err := db.Exec(invitesTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(usersTable)
	if err != nil {
		log.Fatal(err)
	}
}

func inviteUser(c *fiber.Ctx) error {
	type InviteRequest struct {
		Email string `json:"email"`
	}

	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	var existingInviteID string
	err := db.QueryRow("SELECT id FROM invites WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invites (id, email) VALUES (?, ?)", inviteID, req.Email)
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
	type CreateUserRequest struct {
		InviteID string `json:"invite_id"`
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}

	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	var email string
	var used int
	err := db.QueryRow("SELECT email, used FROM invites WHERE id = ?", req.InviteID).Scan(&email, &used)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	if used == 1 {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	var existingUser string
	err = db.QueryRow("SELECT username FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Failed to hash password",
		})
	}

	_, err = db.Exec("INSERT INTO users (username, password, email) VALUES (?, ?, ?)", req.UserName, string(hashedPassword), email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Failed to create user",
		})
	}

	_, err = db.Exec("UPDATE invites SET used = 1 WHERE id = ?", req.InviteID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Failed to update invitation",
		})
	}

	return c.JSON(fiber.Map{
		"message": "User created successfully",
	})
}
</CODE>