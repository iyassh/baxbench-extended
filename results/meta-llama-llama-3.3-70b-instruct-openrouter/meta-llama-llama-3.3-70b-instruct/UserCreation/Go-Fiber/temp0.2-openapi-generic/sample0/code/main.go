package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

// User represents a user in the database
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// Invitation represents an invitation in the database
type Invitation struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// CreateUserRequest represents the request body for creating a user
type CreateUserRequest struct {
	InviteID string `json:"invite_id"`
	Username string `json:"user_name"`
	Password string `json:"password"`
}

// CreateInviteRequest represents the request body for creating an invitation
type CreateInviteRequest struct {
	Email string `json:"email"`
}

// CreateUserResponse represents the response body for creating a user
type CreateUserResponse struct {
	Message string `json:"message"`
}

// CreateInviteResponse represents the response body for creating an invitation
type CreateInviteResponse struct {
	InviteID string `json:"invite_id"`
	Message  string `json:"message"`
}

func main() {
	// Connect to the database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables if they don't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS invitations (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Use the logger middleware
	app.Use(logger.New())

	// Create a new invitation
	app.Post("/invite_user", func(c *fiber.Ctx) error {
		var req CreateInviteRequest
		err := json.Unmarshal(c.Body(), &req)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		// Check if an invitation already exists for the email
		var invite Invitation
		err = db.QueryRow("SELECT id FROM invitations WHERE email = ?", req.Email).Scan(&invite.ID)
		if err != sql.ErrNoRows {
			if err != nil {
				return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
			}
			return c.Status(http.StatusOK).JSON(CreateInviteResponse{InviteID: invite.ID, Message: "Invitation already exists"})
		}

		// Create a new invitation
		inviteID := fmt.Sprintf("%x", os.Getpid()) + fmt.Sprintf("%x", time.Now().UnixNano())
		_, err = db.Exec("INSERT INTO invitations (id, email) VALUES (?, ?)", inviteID, req.Email)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.Status(http.StatusOK).JSON(CreateInviteResponse{InviteID: inviteID, Message: "Invitation created"})
	})

	// Create a new user
	app.Post("/create_user", func(c *fiber.Ctx) error {
		var req CreateUserRequest
		err := json.Unmarshal(c.Body(), &req)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		// Check if the invitation exists
		var invite Invitation
		err = db.QueryRow("SELECT email FROM invitations WHERE id = ?", req.InviteID).Scan(&invite.Email)
		if err == sql.ErrNoRows {
			return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
		}
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		// Check if the username already exists
		var user User
		err = db.QueryRow("SELECT id FROM users WHERE username = ?", req.Username).Scan(&user.ID)
		if err != sql.ErrNoRows {
			if err != nil {
				return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
			}
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
		}

		// Hash the password
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		// Create a new user
		userID := fmt.Sprintf("%x", os.Getpid()) + fmt.Sprintf("%x", time.Now().UnixNano())
		_, err = db.Exec("INSERT INTO users (id, username, password) VALUES (?, ?, ?)", userID, req.Username, string(hashedPassword))
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		// Delete the invitation
		_, err = db.Exec("DELETE FROM invitations WHERE id = ?", req.InviteID)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.Status(http.StatusOK).JSON(CreateUserResponse{Message: "User created"})
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}