package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// User represents a user
type User struct {
	Username string `json:"user_name"`
	Password string `json:"password"`
}

// Invitation represents an invitation
type Invitation struct {
	Email    string `json:"email"`
	InviteID string `json:"invite_id"`
}

// CreateInvitationResponse represents the response for creating an invitation
type CreateInvitationResponse struct {
	InviteID string `json:"invite_id"`
	Message  string `json:"message"`
}

// CreateUserRequest represents the request for creating a user
type CreateUserRequest struct {
	InviteID string `json:"invite_id"`
	Username string `json:"user_name"`
	Password string `json:"password"`
}

// CreateUserResponse represents the response for creating a user
type CreateUserResponse struct {
	Message string `json:"message"`
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
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS invitations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE,
			invite_id TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Create an invitation
	app.Post("/invite_user", func(c *fiber.Ctx) error {
		var invitation Invitation
		err := json.Unmarshal(c.Body(), &invitation)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		// Check if an invitation already exists for the email
		var existingInvitation Invitation
		err = db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", invitation.Email).Scan(&existingInvitation.InviteID)
		if err != sql.ErrNoRows {
			if err != nil {
				return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
			}
			return c.JSON(CreateInvitationResponse{
				InviteID: existingInvitation.InviteID,
				Message:  "Invitation already exists for this email",
			})
		}

		// Generate a new invitation ID
		inviteID := fmt.Sprintf("%x", fiber.UUIDv4())

		// Insert the invitation into the database
		_, err = db.Exec("INSERT INTO invitations (email, invite_id) VALUES (?, ?)", invitation.Email, inviteID)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.JSON(CreateInvitationResponse{
			InviteID: inviteID,
			Message:  "Invitation created successfully",
		})
	})

	// Create a user
	app.Post("/create_user", func(c *fiber.Ctx) error {
		var createUserRequest CreateUserRequest
		err := json.Unmarshal(c.Body(), &createUserRequest)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		// Check if the invitation ID is valid
		var invitation Invitation
		err = db.QueryRow("SELECT email FROM invitations WHERE invite_id = ?", createUserRequest.InviteID).Scan(&invitation.Email)
		if err == sql.ErrNoRows {
			return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
		}
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		// Check if the username already exists
		var existingUser User
		err = db.QueryRow("SELECT username FROM users WHERE username = ?", createUserRequest.Username).Scan(&existingUser.Username)
		if err != sql.ErrNoRows {
			if err != nil {
				return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
			}
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
		}

		// Insert the user into the database
		_, err = db.Exec("INSERT INTO users (username, password) VALUES (?, ?)", createUserRequest.Username, createUserRequest.Password)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		// Delete the invitation
		_, err = db.Exec("DELETE FROM invitations WHERE invite_id = ?", createUserRequest.InviteID)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.JSON(CreateUserResponse{
			Message: "User created successfully",
		})
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}