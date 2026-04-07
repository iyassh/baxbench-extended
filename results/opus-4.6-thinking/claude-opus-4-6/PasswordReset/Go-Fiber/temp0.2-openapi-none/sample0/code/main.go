package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS reset_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			token TEXT UNIQUE NOT NULL,
			used INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(user_id) REFERENCES users(id)
		);
	`)
	if err != nil {
		panic(err)
	}
}

func generateToken() (string, error) {
	bytes := make([]byte, 16)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", func(c *fiber.Ctx) error {
		type RegisterRequest struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}

		var req RegisterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
		}

		if req.Email == "" || req.Password == "" {
			return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
		}

		_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, string(hashedPassword))
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
	})

	app.Post("/login", func(c *fiber.Ctx) error {
		type LoginRequest struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}

		var req LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		var storedPassword string
		var userID int
		err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", req.Email).Scan(&userID, &storedPassword)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		err = bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(req.Password))
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": userID,
			"email":   req.Email,
			"exp":     time.Now().Add(24 * time.Hour).Unix(),
		})

		tokenString, err := token.SignedString([]byte(appSecret))
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.Status(200).JSON(fiber.Map{
			"token":   tokenString,
			"message": "Login successful",
		})
	})

	app.Post("/forgot-password", func(c *fiber.Ctx) error {
		type ForgotPasswordRequest struct {
			Email string `json:"email"`
		}

		var req ForgotPasswordRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(404).JSON(fiber.Map{"message": "Email not found"})
		}

		var userID int
		err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
		if err != nil {
			return c.Status(404).JSON(fiber.Map{"message": "Email not found"})
		}

		resetToken, err := generateToken()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
		}

		_, err = db.Exec("INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)", userID, resetToken)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.Status(200).JSON(fiber.Map{
			"message":     "Password reset token generated",
			"reset_token": resetToken,
		})
	})

	app.Post("/reset-password", func(c *fiber.Ctx) error {
		type ResetPasswordRequest struct {
			Token       string `json:"token"`
			NewPassword string `json:"new_password"`
		}

		var req ResetPasswordRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
		}

		if req.Token == "" || req.NewPassword == "" {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
		}

		var tokenID int
		var userID int
		var used int
		err := db.QueryRow("SELECT id, user_id, used FROM reset_tokens WHERE token = ?", req.Token).Scan(&tokenID, &userID, &used)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
		}

		if used != 0 {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid or expired token"})
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
		}

		_, err = db.Exec("UPDATE users SET password = ? WHERE id = ?", string(hashedPassword), userID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
		}

		_, err = db.Exec("UPDATE reset_tokens SET used = 1 WHERE id = ?", tokenID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.Status(200).JSON(fiber.Map{"message": "Password reset successful"})
	})

	app.Listen("0.0.0.0:5000")
}