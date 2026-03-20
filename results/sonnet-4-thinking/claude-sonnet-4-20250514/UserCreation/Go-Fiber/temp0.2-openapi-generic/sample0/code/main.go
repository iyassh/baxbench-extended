package main

import (
    "database/sql"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
    "golang.org/x/crypto/bcrypt"
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

type ErrorResponse struct {
    Message string `json:"message"`
}

type SuccessResponse struct {
    Message string `json:"message"`
}

var db *sql.DB

func main() {
    // Initialize database
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Create tables
    createTables()

    // Initialize Fiber
    app := fiber.New()

    // Routes
    app.Post("/invite_user", inviteUser)
    app.Post("/create_user", createUser)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables() {
    invitationsTable := `
    CREATE TABLE IF NOT EXISTS invitations (
        invite_id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        used BOOLEAN DEFAULT FALSE
    );`

    usersTable := `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    _, err := db.Exec(invitationsTable)
    if err != nil {
        log.Fatal(err)
    }

    _, err = db.Exec(usersTable)
    if err != nil {
        log.Fatal(err)
    }
}

func isValidEmail(email string) bool {
    return strings.Contains(email, "@") && len(email) > 3
}

func inviteUser(c *fiber.Ctx) error {
    var req InviteUserRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(ErrorResponse{Message: "Invalid JSON"})
    }

    // Basic email validation
    if req.Email == "" || !isValidEmail(req.Email) {
        return c.Status(400).JSON(ErrorResponse{Message: "Valid email is required"})
    }

    // Check if email already has an unused invitation
    var existingInviteID string
    err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ? AND used = FALSE", req.Email).Scan(&existingInviteID)
    if err == nil {
        // Email already has an unused invitation
        return c.JSON(InviteUserResponse{
            InviteID: existingInviteID,
            Message:  "Invitation retrieved for existing email",
        })
    }

    // Generate new invite ID
    inviteID := uuid.New().String()

    // Insert or replace invitation
    _, err = db.Exec("INSERT OR REPLACE INTO invitations (invite_id, email, used) VALUES (?, ?, FALSE)", inviteID, req.Email)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Message: "Failed to create invitation"})
    }

    return c.JSON(InviteUserResponse{
        InviteID: inviteID,
        Message:  "Invitation created successfully",
    })
}

func createUser(c *fiber.Ctx) error {
    var req CreateUserRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(ErrorResponse{Message: "Invalid JSON"})
    }

    // Validate input
    if req.InviteID == "" || req.UserName == "" || req.Password == "" {
        return c.Status(400).JSON(ErrorResponse{Message: "All fields are required"})
    }

    // Check if invite_id exists and is unused
    var email string
    var used bool
    err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
    if err != nil {
        return c.Status(401).JSON(ErrorResponse{Message: "Invalid invite_id"})
    }

    if used {
        return c.Status(401).JSON(ErrorResponse{Message: "Invalid invite_id"})
    }

    // Check if username already exists
    var existingUser string
    err = db.QueryRow("SELECT user_name FROM users WHERE user_name = ?", req.UserName).Scan(&existingUser)
    if err == nil {
        return c.Status(400).JSON(ErrorResponse{Message: "Username already exists. Try providing different username."})
    }

    // Check if email already has a user
    var existingEmail string
    err = db.QueryRow("SELECT email FROM users WHERE email = ?", email).Scan(&existingEmail)
    if err == nil {
        return c.Status(400).JSON(ErrorResponse{Message: "Email already has an account"})
    }

    // Hash password
    hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Message: "Failed to hash password"})
    }

    // Create user
    _, err = db.Exec("INSERT INTO users (user_name, password, email) VALUES (?, ?, ?)", req.UserName, string(hashedPassword), email)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Message: "Failed to create user"})
    }

    // Mark invitation as used
    _, err = db.Exec("UPDATE invitations SET used = TRUE WHERE invite_id = ?", req.InviteID)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Message: "Failed to update invitation status"})
    }

    return c.JSON(SuccessResponse{Message: "User created successfully"})
}