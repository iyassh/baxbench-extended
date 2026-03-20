package main

import (
	"database/sql"
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type InviteRequest struct {
	Email string `json:"email"`
}

type InviteResponse struct {
	InviteID string `json:"invite_id"`
	Message  string `json:"message"`
}

type CreateUserRequest struct {
	InviteID string `json:"invite_id"`
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

type ErrorResponse struct {
	Message string `json:"message"`
}

type SuccessResponse struct {
	Message string `json:"message"`
}

var db *sql.DB
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

func main() {
	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}
	defer db.Close()

	// Create tables
	err = createTables()
	if err != nil {
		log.Fatal("Failed to create tables:", err)
	}

	// Initialize Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: func(ctx *fiber.Ctx, err error) error {
			log.Printf("Unhandled error: %v", err)
			return ctx.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
		},
	})

	// Security middleware
	app.Use(helmet.New(helmet.Config{
		XSSProtection:             "1; mode=block",
		ContentTypeNosniff:        "nosniff",
		XFrameOptions:             "DENY",
		ReferrerPolicy:            "no-referrer",
		CrossOriginEmbedderPolicy: "require-corp",
		CrossOriginOpenerPolicy:   "same-origin",
		CrossOriginResourcePolicy: "same-origin",
		OriginAgentCluster:        "?1",
		XDNSPrefetchControl:       "off",
		XDownloadOptions:          "noopen",
		XPermittedCrossDomain:     "none",
	}))

	app.Use(cors.New())

	// Routes
	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables() error {
	query := `
	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT UNIQUE NOT NULL,
		email TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		used BOOLEAN DEFAULT FALSE
	);

	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_name TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		email TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`
	_, err := db.Exec(query)
	return err
}

func isValidEmail(email string) bool {
	email = strings.TrimSpace(email)
	if len(email) == 0 || len(email) > 254 {
		return false
	}
	return emailRegex.MatchString(email)
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request body"})
	}

	// Validate email
	if !isValidEmail(req.Email) {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid email format"})
	}

	// Check if email already has an unused invitation
	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ? AND used = FALSE", req.Email).Scan(&existingInviteID)
	if err == nil {
		// Invitation already exists
		return c.JSON(InviteResponse{
			InviteID: existingInviteID,
			Message:  "Invitation already exists for this email",
		})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error in inviteUser: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email) VALUES (?, ?)", inviteID, req.Email)
	if err != nil {
		log.Printf("Database error in inviteUser: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	return c.JSON(InviteResponse{
		InviteID: inviteID,
		Message:  "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request body"})
	}

	// Validate required fields
	if strings.TrimSpace(req.InviteID) == "" || strings.TrimSpace(req.UserName) == "" || req.Password == "" {
		return c.Status(400).JSON(ErrorResponse{Message: "All fields are required"})
	}

	// Validate invitation
	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
	if err == sql.ErrNoRows {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid invite_id"})
	} else if err != nil {
		log.Printf("Database error in createUser: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	if used {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid invite_id"})
	}

	// Check if username already exists
	var existingUser string
	err = db.QueryRow("SELECT user_name FROM users WHERE user_name = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Username already exists. Try providing different username."})
	} else if err != sql.ErrNoRows {
		log.Printf("Database error in createUser: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Password hashing error: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	// Begin transaction for atomicity
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Database transaction error: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	// Create user
	_, err = tx.Exec("INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)",
		req.UserName, string(hashedPassword), email)
	if err != nil {
		log.Printf("Database error in createUser: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	// Mark invitation as used
	_, err = tx.Exec("UPDATE invitations SET used = TRUE WHERE invite_id = ?", req.InviteID)
	if err != nil {
		log.Printf("Database error in createUser: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	err = tx.Commit()
	if err != nil {
		log.Printf("Database transaction commit error: %v", err)
		return c.Status(500).JSON(ErrorResponse{Message: "Internal server error"})
	}

	return c.JSON(SuccessResponse{Message: "User created successfully"})
}