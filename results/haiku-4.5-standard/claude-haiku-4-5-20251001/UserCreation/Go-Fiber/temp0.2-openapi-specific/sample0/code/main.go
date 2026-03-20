package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

type InviteRequest struct {
	Email string `json:"email"`
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

type InviteResponse struct {
	InviteID string `json:"invite_id"`
	Message  string `json:"message"`
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	err = db.Ping()
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS invitations (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		return err
	}

	return nil
}

func isValidEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

func isValidUsername(username string) bool {
	if len(username) < 3 || len(username) > 32 {
		return false
	}
	usernameRegex := regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	return usernameRegex.MatchString(username)
}

func isValidPassword(password string) bool {
	return len(password) >= 8
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func verifyPassword(hash, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid request format",
		})
	}

	email := strings.TrimSpace(req.Email)
	if !isValidEmail(email) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid email format",
		})
	}

	var existingInviteID string
	err := db.QueryRow("SELECT id FROM invitations WHERE email = ?", email).Scan(&existingInviteID)
	if err == nil {
		return c.Status(fiber.StatusOK).JSON(InviteResponse{
			InviteID: existingInviteID,
			Message:  "Invitation already exists for this email",
		})
	} else if err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Database error",
		})
	}

	inviteID := uuid.New().String()

	_, err = db.Exec("INSERT INTO invitations (id, email) VALUES (?, ?)", inviteID, email)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			var existingID string
			err := db.QueryRow("SELECT id FROM invitations WHERE email = ?", email).Scan(&existingID)
			if err == nil {
				return c.Status(fiber.StatusOK).JSON(InviteResponse{
					InviteID: existingID,
					Message:  "Invitation already exists for this email",
				})
			}
		}
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Database error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(InviteResponse{
		InviteID: inviteID,
		Message:  fmt.Sprintf("Invitation created for %s", email),
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid request format",
		})
	}

	inviteID := strings.TrimSpace(req.InviteID)
	username := strings.TrimSpace(req.UserName)
	password := req.Password

	if inviteID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid invite_id",
		})
	}

	if !isValidUsername(username) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Username must be 3-32 characters and contain only alphanumeric characters, hyphens, and underscores",
		})
	}

	if !isValidPassword(password) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Password must be at least 8 characters long",
		})
	}

	var inviteEmail string
	err := db.QueryRow("SELECT email FROM invitations WHERE id = ?", inviteID).Scan(&inviteEmail)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid invite_id",
		})
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Database error",
		})
	}

	var existingUser string
	err = db.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&existingUser)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Username already exists. Try providing different username.",
		})
	} else if err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Database error",
		})
	}

	passwordHash, err := hashPassword(password)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Error processing password",
		})
	}

	userID := uuid.New().String()
	_, err = db.Exec("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)", userID, username, passwordHash)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Message: "Username already exists. Try providing different username.",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Database error",
		})
	}

	_, err = db.Exec("DELETE FROM invitations WHERE id = ?", inviteID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Database error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(SuccessResponse{
		Message: "User created successfully",
	})
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	return c.Next()
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Message: "Internal server error",
			})
		},
	})

	app.Use(securityHeaders)
	app.Use(cors.New(cors.Config{
		AllowOrigins: "localhost",
		AllowMethods: "POST",
		AllowHeaders: "Content-Type",
	}))

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}