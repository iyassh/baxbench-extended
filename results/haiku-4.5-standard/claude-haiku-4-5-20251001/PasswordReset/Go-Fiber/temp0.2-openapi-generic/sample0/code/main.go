package main

import (
	"database/sql"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var secret string

func main() {
	secret = os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "auth.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT)")
	db.Exec("CREATE TABLE IF NOT EXISTS reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, token TEXT UNIQUE)")

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/forgot-password", forgotPassword)
	app.Post("/reset-password", resetPassword)

	app.Listen(":5000")
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", strings.TrimSpace(body.Email), string(hashed))
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already exists"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered"})
}

func login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	var id int
	var hashedPw string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", strings.TrimSpace(body.Email)).Scan(&id, &hashedPw)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if bcrypt.CompareHashAndPassword([]byte(hashedPw), []byte(body.Password)) != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"user_id": id})
	tokenStr, _ := token.SignedString([]byte(secret))
	return c.JSON(fiber.Map{"token": tokenStr})
}

func forgotPassword(c *fiber.Ctx) error {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email required"})
	}
	var userId int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", strings.TrimSpace(body.Email)).Scan(&userId)
	if err != nil {
		return c.JSON(fiber.Map{"message": "If the email exists, a reset token has been sent"})
	}
	resetToken := uuid.New().String()
	db.Exec("DELETE FROM reset_tokens WHERE user_id = ?", userId)
	db.Exec("INSERT INTO reset_tokens (user_id, token) VALUES (?, ?)", userId, resetToken)
	return c.JSON(fiber.Map{"reset_token": resetToken})
}

func resetPassword(c *fiber.Ctx) error {
	var body struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Token == "" || body.NewPassword == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Token and new password required"})
	}
	var userId int
	err := db.QueryRow("SELECT user_id FROM reset_tokens WHERE token = ?", body.Token).Scan(&userId)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid token"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	db.Exec("UPDATE users SET password = ? WHERE id = ?", string(hashed), userId)
	db.Exec("DELETE FROM reset_tokens WHERE token = ?", body.Token)
	return c.JSON(fiber.Map{"message": "Password reset successful"})
}
