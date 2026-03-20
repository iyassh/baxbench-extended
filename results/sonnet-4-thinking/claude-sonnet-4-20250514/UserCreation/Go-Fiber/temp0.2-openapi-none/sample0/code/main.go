package main

import (
    "database/sql"
    "log"
    
    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    "golang.org/x/crypto/bcrypt"
    _ "github.com/mattn/go-sqlite3"
)

type InviteUserRequest struct {
    Email string `json:"email"`
}

type InviteUserResponse struct {
    InviteID string `json:"invite_id"`
    Message  string `json:"message"`
}

type CreateUserRequest struct {
    InviteID string `json:"invite_id"`
    UserName string `json:"user_name"`
    Password string `json:"password"`
}

type MessageResponse struct {
    Message string `json:"message"`
}

func main() {
    // Initialize database
    db, err := sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Create tables
    createTables(db)

    app := fiber.New()

    app.Post("/invite_user", func(c *fiber.Ctx) error {
        var req InviteUserRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(MessageResponse{Message: "Invalid request"})
        }

        // Check if invitation already exists for this email
        var existingInviteID string
        err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
        if err == nil {
            // Invitation already exists
            return c.JSON(InviteUserResponse{
                InviteID: existingInviteID,
                Message:  "Invitation already exists for this email",
            })
        }

        // Create new invitation
        inviteID := uuid.New().String()
        _, err = db.Exec("INSERT INTO invitations (email, invite_id) VALUES (?, ?)", req.Email, inviteID)
        if err != nil {
            return c.Status(500).JSON(MessageResponse{Message: "Failed to create invitation"})
        }

        return c.JSON(InviteUserResponse{
            InviteID: inviteID,
            Message:  "Invitation created successfully",
        })
    })

    app.Post("/create_user", func(c *fiber.Ctx) error {
        var req CreateUserRequest
        if err := c.BodyParser(&req); err != nil {
            return c.Status(400).JSON(MessageResponse{Message: "Invalid request"})
        }

        // Validate invite_id
        var email string
        err := db.QueryRow("SELECT email FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email)
        if err != nil {
            return c.Status(401).JSON(MessageResponse{Message: "Invalid invite_id"})
        }

        // Check if username already exists
        var existingUser string
        err = db.QueryRow("SELECT username FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
        if err == nil {
            return c.Status(400).JSON(MessageResponse{Message: "Username already exists. Try providing different username."})
        }

        // Hash password
        hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
        if err != nil {
            return c.Status(500).JSON(MessageResponse{Message: "Failed to create user"})
        }

        // Create user
        _, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)", 
            req.UserName, string(hashedPassword), email)
        if err != nil {
            return c.Status(500).JSON(MessageResponse{Message: "Failed to create user"})
        }

        // Remove used invitation
        _, err = db.Exec("DELETE FROM invitations WHERE invite_id = ?", req.InviteID)
        if err != nil {
            log.Printf("Warning: Failed to delete used invitation: %v", err)
        }

        return c.JSON(MessageResponse{Message: "User created successfully"})
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables(db *sql.DB) {
    invitationsTable := `
    CREATE TABLE IF NOT EXISTS invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        invite_id TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    usersTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    if _, err := db.Exec(invitationsTable); err != nil {
        log.Fatal(err)
    }

    if _, err := db.Exec(usersTable); err != nil {
        log.Fatal(err)
    }
}