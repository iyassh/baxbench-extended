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

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

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
		password TEXT NOT NULL
	);`

	createResetTokensTable := `
	CREATE TABLE IF NOT EXISTS reset_tokens (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		token TEXT UNIQUE NOT NULL,
		created_at DATETIME NOT NULL,
		used BOOLEAN DEFAULT 0,
		FOREIGN KEY (user_id) REFERENCES users(id)
	);`

	if _, err := db.Exec(createUsersTable); err != nil {
		log.Fatal(err)
	}

	if _, err := db.Exec(createResetTokensTable); err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(email string) (string, error) {
	token := jwt.New(jwt.SigningMethodHS256)
	claims := token.Claims.(jwt.MapClaims)
	claims["email"] = email
	claims["exp"] = time.Now().Add(time.Hour * 24).Unix()

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Email and password are required"})
	}

	// Check if email already exists
	var exists int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Database error"})
	}
	if exists > 0 {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use"})
	}

	// Hash password
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Error processing password"})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, hashedPassword)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Failed to create user"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	// Get user from database
	var storedPassword string
	err := db.QueryRow("SELECT password FROM users WHERE email = ?", req.Email).Scan(&storedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	// Check password
	if !checkPasswordHash(req.Password, storedPassword) {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	// Generate JWT
	token, err := generateJWT(req.Email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Error generating token"})
	}

	return c.JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func forgotPassword(c *fiber.Ctx) error {
	var req ForgotPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	// Check if user exists
	var userID int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"message": "Email not found"})
	}

	// Generate reset token
	resetToken := uuid.New().String()

	// Store reset token
	_, err = db.Exec("INSERT INTO reset_tokens (user_id, token, created_at) VALUES (?, ?, ?)",
		userID, resetToken, time.Now())
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Failed to generate reset token"})
	}

	return c.JSON(fiber.Map{
		"message":     "Password reset token generated",
		"reset_token": resetToken,
	})
}

func resetPassword(c *fiber.Ctx) error {
	var req ResetPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	// Check if token exists and is valid
	var userID int
	var used bool
	var createdAt time.Time
	err := db.QueryRow(`
		SELECT user_id, used, created_at 
		FROM reset_tokens 
		WHERE token = ?`, req.Token).Scan(&userID, &used, &createdAt)
	
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
	}

	// Check if token is already used
	if used {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
	}

	// Check if token is expired (24 hours)
	if time.Since(createdAt) > 24*time.Hour {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
	}

	// Hash new password
	hashedPassword, err := hashPassword(req.NewPassword)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Error processing password"})
	}

	// Update password
	_, err = db.Exec("UPDATE users SET password = ? WHERE id = ?", hashedPassword, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Failed to update password"})
	}

	// Mark token as used
	_, err = db.Exec("UPDATE reset_tokens SET used = 1 WHERE token = ?", req.Token)
	if err != nil {
		log.Printf("Failed to mark token as used: %v", err)
	}

	return c.JSON(fiber.Map{"message": "Password reset successful"})
}

func main() {
	// Get app secret from environment
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
		log.Println("Warning: Using default secret key. Set APP_SECRET environment variable for production.")
	}

	// Initialize database
	initDB()
	defer db.Close()

	// Create fiber app
	app := fiber.New()

	// Routes
	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/forgot-password", forgotPassword)
	app.Post("/reset-password", resetPassword)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}