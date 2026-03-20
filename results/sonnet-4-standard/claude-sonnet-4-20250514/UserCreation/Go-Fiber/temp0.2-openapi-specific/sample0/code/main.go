package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
		used INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		email TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err = db.Exec(createTables)
	return err
}

func generateInviteID() (string, error) {
	bytes := make([]byte, 16)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func isValidEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

func isValidUsername(username string) bool {
	if len(username) < 3 || len(username) > 50 {
		return false
	}
	usernameRegex := regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	return usernameRegex.MatchString(username)
}

func isValidPassword(password string) bool {
	return len(password) >= 8
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(Response{Message: "Invalid request format"})
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	if !isValidEmail(req.Email) {
		return c.Status(400).JSON(Response{Message: "Invalid email format"})
	}

	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(Response{
			InviteID: existingInviteID,
			Message:  "Invitation already exists for this email",
		})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	var userExists bool
	err = db.QueryRow("SELECT 1 FROM users WHERE email = ?", req.Email).Scan(&userExists)
	if err == nil {
		return c.Status(400).JSON(Response{Message: "User already exists with this email"})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	inviteID, err := generateInviteID()
	if err != nil {
		log.Printf("Error generating invite ID: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO invitations (invite_id, email) VALUES (?, ?)", inviteID, req.Email)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	return c.JSON(Response{
		InviteID: inviteID,
		Message:  "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(Response{Message: "Invalid request format"})
	}

	req.InviteID = strings.TrimSpace(req.InviteID)
	req.UserName = strings.TrimSpace(req.UserName)

	if req.InviteID == "" || req.UserName == "" || req.Password == "" {
		return c.Status(400).JSON(Response{Message: "All fields are required"})
	}

	if !isValidUsername(req.UserName) {
		return c.Status(400).JSON(Response{Message: "Username must be 3-50 characters and contain only letters, numbers, hyphens, and underscores"})
	}

	if !isValidPassword(req.Password) {
		return c.Status(400).JSON(Response{Message: "Password must be at least 8 characters long"})
	}

	var email string
	var used int
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
	if err == sql.ErrNoRows {
		return c.Status(401).JSON(Response{Message: "Invalid invite_id"})
	} else if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	if used == 1 {
		return c.Status(401).JSON(Response{Message: "Invalid invite_id"})
	}

	var existingUser bool
	err = db.QueryRow("SELECT 1 FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(Response{Message: "Username already exists. Try providing different username."})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	err = db.QueryRow("SELECT 1 FROM users WHERE email = ?", email).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(Response{Message: "User already exists with this email"})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", req.UserName, string(hashedPassword), email)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	_, err = tx.Exec("UPDATE invitations SET used = 1 WHERE invite_id = ?", req.InviteID)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	err = tx.Commit()
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(Response{Message: "Internal server error"})
	}

	return c.JSON(Response{Message: "User created successfully"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal server error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				message = e.Message
			}

			return c.Status(code).JSON(Response{Message: message})
		},
		DisableStartupMessage: true,
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(recover.New())

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}