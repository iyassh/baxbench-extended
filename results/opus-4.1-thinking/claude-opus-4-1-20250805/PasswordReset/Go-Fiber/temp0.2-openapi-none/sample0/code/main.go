package main

import (
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type ForgotPasswordRequest struct {
	Email string `json:"email"`
}

type ResetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type ForgotPasswordResponse struct {
	Message    string `json:"message"`
	ResetToken string `json:"reset_token"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	
	_, err = db.Exec(createUsersTable)
	if err != nil {
		log.Fatal(err)
	}

	createTokensTable := `
	CREATE TABLE IF NOT EXISTS reset_tokens (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT NOT NULL,
		token TEXT UNIQUE NOT NULL,
		used BOOLEAN DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL
	);`
	
	_, err = db.Exec(createTokensTable)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)
	app.Post("/forgot-password", forgotPasswordHandler)
	app.Post("/reset-password", resetPasswordHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid data"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(MessageResponse{Message: "Email and password are required"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)", req.Email).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Database error"})
	}

	if exists {
		return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error hashing password"})
	}

	_, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, string(hashedPassword))
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error creating user"})
	}

	return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	var passwordHash string
	err := db.QueryRow("SELECT password_hash FROM users WHERE email = ?", req.Email).Scan(&passwordHash)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
		}
		return c.Status(500).JSON(MessageResponse{Message: "Database error"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": req.Email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error generating token"})
	}

	return c.Status(200).JSON(LoginResponse{
		Token:   tokenString,
		Message: "Login successful",
	})
}

func forgotPasswordHandler(c *fiber.Ctx) error {
	var req ForgotPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(404).JSON(MessageResponse{Message: "Email not found"})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)", req.Email).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Database error"})
	}

	if !exists {
		return c.Status(404).JSON(MessageResponse{Message: "Email not found"})
	}

	resetToken := uuid.New().String()
	expiresAt := time.Now().Add(time.Hour * 1)

	_, err = db.Exec("INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)", 
		req.Email, resetToken, expiresAt)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error generating token"})
	}

	return c.Status(200).JSON(ForgotPasswordResponse{
		Message:    "Password reset token generated",
		ResetToken: resetToken,
	})
}

func resetPasswordHandler(c *fiber.Ctx) error {
	var req ResetPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
	}

	var email string
	var used bool
	var expiresAt time.Time
	err := db.QueryRow(`
		SELECT email, used, expires_at 
		FROM reset_tokens 
		WHERE token = ?`, req.Token).Scan(&email, &used, &expiresAt)
	
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
		}
		return c.Status(500).JSON(MessageResponse{Message: "Database error"})
	}

	if used || time.Now().After(expiresAt) {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid or expired token"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error hashing password"})
	}

	_, err = db.Exec("UPDATE users SET password_hash = ? WHERE email = ?", string(hashedPassword), email)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error updating password"})
	}

	_, err = db.Exec("UPDATE reset_tokens SET used = 1 WHERE token = ?", req.Token)
	if err != nil {
		log.Printf("Error marking token as used: %v", err)
	}

	return c.Status(200).JSON(MessageResponse{Message: "Password reset successful"})
}