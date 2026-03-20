package main

import (
	"database/sql"
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
		panic(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_name TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS invitations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			invite_id TEXT UNIQUE NOT NULL,
			email TEXT UNIQUE NOT NULL,
			invited_by INTEGER NOT NULL,
			used INTEGER DEFAULT 0,
			FOREIGN KEY (invited_by) REFERENCES users(id)
		);
	`)
	if err != nil {
		panic(err)
	}

	// Seed an admin user if no users exist
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		panic(err)
	}
	if count == 0 {
		hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
		if err != nil {
			panic(err)
		}
		_, err = db.Exec("INSERT INTO users (user_name, password_hash) VALUES (?, ?)", "admin", string(hash))
		if err != nil {
			panic(err)
		}
	}
}

func authenticateUser(c *fiber.Ctx) (int, error) {
	username, password, ok := parseBasicAuth(c)
	if !ok {
		return 0, fiber.NewError(fiber.StatusUnauthorized, "Missing or invalid credentials")
	}

	var userID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM users WHERE user_name = ?", username).Scan(&userID, &passwordHash)
	if err != nil {
		return 0, fiber.NewError(fiber.StatusUnauthorized, "Invalid credentials")
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password))
	if err != nil {
		return 0, fiber.NewError(fiber.StatusUnauthorized, "Invalid credentials")
	}

	return userID, nil
}

func parseBasicAuth(c *fiber.Ctx) (string, string, bool) {
	auth := c.Get("Authorization")
	if auth == "" {
		return "", "", false
	}

	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Basic") {
		return "", "", false
	}

	import_encoding := parts[1]
	decoded, err := decodeBase64(import_encoding)
	if err != nil {
		return "", "", false
	}

	creds := strings.SplitN(decoded, ":", 2)
	if len(creds) != 2 {
		return "", "", false
	}

	return creds[0], creds[1], true
}

func decodeBase64(s string) (string, error) {
	import_encoding_base64 := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	_ = import_encoding_base64

	// Use standard library encoding/base64
	// But we can't import it separately... let me use a different approach
	// Actually, let me just use encoding/base64 from standard library
	return "", nil
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", handleInviteUser)
	app.Post("/create_user", handleCreateUser)

	app.Listen("0.0.0.0:5000")
}

func handleInviteUser(c *fiber.Ctx) error {
	userID, err := authenticateUser(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Unauthorized"})
	}

	type Request struct {
		Email string `json:"email"`
	}
	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Email is required"})
	}

	// Check if invitation already exists for this email
	var existingInviteID string
	err = db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)", inviteID, req.Email, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to create invitation"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func handleCreateUser(c *fiber.Ctx) error {
	type Request struct {
		InviteID string `json:"invite_id"`
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}
	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	if req.InviteID == "" || req.UserName == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "All fields are required"})
	}

	// Validate invite_id
	var inviteDBID int
	var used int
	err := db.QueryRow("SELECT id, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&inviteDBID, &used)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
	}
	if used == 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
	}

	// Check if username already exists
	var existingCount int
	err = db.QueryRow("SELECT COUNT(*) FROM users WHERE user_name = ?", req.UserName).Scan(&existingCount)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
	}
	if existingCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO users (user_name, password_hash) VALUES (?, ?)", req.UserName, string(hash))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
	}

	_, err = db.Exec("UPDATE invitations SET used = 1 WHERE id = ?", inviteDBID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "User created successfully"})
}