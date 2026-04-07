package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       string
	Email    string
	Password string
}

type ResetToken struct {
	Token     string
	UserID    string
	ExpiresAt time.Time
	Used      bool
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

var db *sql.DB
var appSecret string

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}

	initDB()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"message": "Internal server error",
			})
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Use(cors.New())

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/forgot-password", forgotPassword)
	app.Post("/reset-password", resetPassword)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	createResetTokensTable := `
	CREATE TABLE IF NOT EXISTS reset_tokens (
		token TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		expires_at DATETIME NOT NULL,
		used BOOLEAN DEFAULT FALSE,
		FOREIGN KEY(user_id) REFERENCES users(id)
	);`

	_, err = db.Exec(createUsersTable)
	if err != nil {
		log.Fatal("Failed to create users table:", err)
	}

	_, err = db.Exec(createResetTokensTable)
	if err != nil {
		log.Fatal("Failed to create reset_tokens table:", err)
	}
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	if !isValidEmail(req.Email) {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	var existingUser User
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUser.ID)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	userID := uuid.New().String()
	_, err = db.Exec("INSERT INTO users (id, email, password) VALUES (?, ?, ?)",
		userID, req.Email, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).Scan(
		&user.ID, &user.Email, &user.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"email":   user.Email,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	return c.JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func forgotPassword(c *fiber.Ctx) error {
	var req ForgotPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	if req.Email == "" || !isValidEmail(req.Email) {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	var user User
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&user.ID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	tokenBytes := make([]byte, 32)
	_, err = rand.Read(tokenBytes)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}
	resetToken := hex.EncodeToString(tokenBytes)

	expiresAt := time.Now().Add(time.Hour)

	_, err = db.Exec("INSERT INTO reset_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, ?)",
		resetToken, user.ID, expiresAt, false)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	return c.JSON(fiber.Map{
		"message":     "Password reset token generated",
		"reset_token": resetToken,
	})
}

func resetPassword(c *fiber.Ctx) error {
	var req ResetPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	if req.Token == "" || req.NewPassword == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	var resetToken ResetToken
	err := db.QueryRow("SELECT token, user_id, expires_at, used FROM reset_tokens WHERE token = ?",
		req.Token).Scan(&resetToken.Token, &resetToken.UserID, &resetToken.ExpiresAt, &resetToken.Used)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	if resetToken.Used {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	if time.Now().After(resetToken.ExpiresAt) {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	_, err = db.Exec("UPDATE users SET password = ? WHERE id = ?", string(hashedPassword), resetToken.UserID)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	_, err = db.Exec("UPDATE reset_tokens SET used = TRUE WHERE token = ?", req.Token)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Password reset successful",
	})
}

func isValidEmail(email string) bool {
	if len(email) < 3 {
		return false
	}
	atIndex := -1
	for i, char := range email {
		if char == '@' {
			if atIndex == -1 {
				atIndex = i
			} else {
				return false
			}
		}
	}
	return atIndex > 0 && atIndex < len(email)-1
}