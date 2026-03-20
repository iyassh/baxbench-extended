<CODE>
package main

import (
	"database/sql"
	"log"
	"os"
	"regexp"

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

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/invite_user", inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"message": message,
	})
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
		password_hash TEXT NOT NULL,
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	if !isValidEmail(req.Email) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid email format",
		})
	}

	var existingInviteID string
	err := db.QueryRow("SELECT id FROM invites WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	} else if err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	inviteID := uuid.New().String()

	stmt, err := db.Prepare("INSERT INTO invites (id, email, used) VALUES (?, ?, 0)")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}
	defer stmt.Close()

	_, err = stmt.Exec(inviteID, req.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
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
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	if req.InviteID == "" || req.UserName == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Missing required fields",
		})
	}

	if !isValidUsername(req.UserName) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid username format",
		})
	}

	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Password must be at least 8 characters",
		})
	}

	var email string
	var used int
	err := db.QueryRow("SELECT email, used FROM invites WHERE id = ?", req.InviteID).Scan(&email, &used)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	if used == 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	var existingUser string
	err = db.QueryRow("SELECT username FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	} else if err != sql.ErrNoRows {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Error processing password",
		})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	stmt, err := tx.Prepare("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)")
	if err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}
	defer stmt.Close()

	_, err = stmt.Exec(req.UserName, string(hashedPassword), email)
	if err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	updateStmt, err := tx.Prepare("UPDATE invites SET used = 1 WHERE id = ?")
	if err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}
	defer updateStmt.Close()

	_, err = updateStmt.Exec(req.InviteID)
	if err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	err = tx.Commit()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "User created successfully",
	})
}

func isValidEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

func isValidUsername(username string) bool {
	if len(username) < 3 || len(username) > 50 {
		return false
	}
	usernameRegex := regexp.MustCompile(`^[a-zA-Z0-9_\-]+$`)
	return usernameRegex.MatchString(username)
}
</CODE>