package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

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

type Response struct {
	Message    string `json:"message"`
	Token      string `json:"token,omitempty"`
	ResetToken string `json:"reset_token,omitempty"`
}

type User struct {
	ID       int
	Email    string
	Password string
}

type PasswordReset struct {
	ID        int
	Email     string
	Token     string
	CreatedAt time.Time
	Used      bool
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS password_resets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			token TEXT UNIQUE NOT NULL,
			created_at DATETIME NOT NULL,
			used BOOLEAN NOT NULL DEFAULT FALSE
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(email string) (string, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	})

	return token.SignedString([]byte(secret))
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(Response{
			Message: "Email already in use or invalid data",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(Response{
			Message: "Email already in use or invalid data",
		})
	}

	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
	if err != nil {
		return c.Status(400).JSON(Response{
			Message: "Email already in use or invalid data",
		})
	}

	if count > 0 {
		return c.Status(400).JSON(Response{
			Message: "Email already in use or invalid data",
		})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(400).JSON(Response{
			Message: "Email already in use or invalid data",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, hashedPassword)
	if err != nil {
		return c.Status(400).JSON(Response{
			Message: "Email already in use or invalid data",
		})
	}

	return c.Status(201).JSON(Response{
		Message: "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(Response{
			Message: "Invalid email or password",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(401).JSON(Response{
			Message: "Invalid email or password",
		})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password)
	if err != nil {
		return c.Status(401).JSON(Response{
			Message: "Invalid email or password",
		})
	}

	if !checkPassword(req.Password, user.Password) {
		return c.Status(401).JSON(Response{
			Message: "Invalid email or password",
		})
	}

	token, err := generateJWT(user.Email)
	if err != nil {
		return c.Status(401).JSON(Response{
			Message: "Invalid email or password",
		})
	}

	return c.Status(200).JSON(Response{
		Token:   token,
		Message: "Login successful",
	})
}

func forgotPassword(c *fiber.Ctx) error {
	var req ForgotPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(404).JSON(Response{
			Message: "Email not found",
		})
	}

	if req.Email == "" {
		return c.Status(404).JSON(Response{
			Message: "Email not found",
		})
	}

	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
	if err != nil || count == 0 {
		return c.Status(404).JSON(Response{
			Message: "Email not found",
		})
	}

	resetToken := uuid.New().String()

	_, err = db.Exec("INSERT INTO password_resets (email, token, created_at, used) VALUES (?, ?, ?, ?)",
		req.Email, resetToken, time.Now(), false)
	if err != nil {
		return c.Status(404).JSON(Response{
			Message: "Email not found",
		})
	}

	return c.Status(200).JSON(Response{
		Message:    "Password reset token generated",
		ResetToken: resetToken,
	})
}

func resetPassword(c *fiber.Ctx) error {
	var req ResetPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(Response{
			Message: "Invalid or expired token",
		})
	}

	if req.Token == "" || req.NewPassword == "" {
		return c.Status(400).JSON(Response{
			Message: "Invalid or expired token",
		})
	}

	var resetRecord PasswordReset
	err := db.QueryRow("SELECT id, email, token, created_at, used FROM password_resets WHERE token = ? AND used = FALSE",
		req.Token).Scan(&resetRecord.ID, &resetRecord.Email, &resetRecord.Token, &resetRecord.CreatedAt, &resetRecord.Used)
	if err != nil {
		return c.Status(400).JSON(Response{
			Message: "Invalid or expired token",
		})
	}

	if time.Since(resetRecord.CreatedAt) > 24*time.Hour {
		return c.Status(400).JSON(Response{
			Message: "Invalid or expired token",
		})
	}

	hashedPassword, err := hashPassword(req.NewPassword)
	if err != nil {
		return c.Status(400).JSON(Response{
			Message: "Invalid or expired token",
		})
	}

	_, err = db.Exec("UPDATE users SET password = ? WHERE email = ?", hashedPassword, resetRecord.Email)
	if err != nil {
		return c.Status(400).JSON(Response{
			Message: "Invalid or expired token",
		})
	}

	_, err = db.Exec("UPDATE password_resets SET used = TRUE WHERE id = ?", resetRecord.ID)
	if err != nil {
		return c.Status(400).JSON(Response{
			Message: "Invalid or expired token",
		})
	}

	return c.Status(200).JSON(Response{
		Message: "Password reset successful",
	})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/forgot-password", forgotPassword)
	app.Post("/reset-password", resetPassword)

	fmt.Println("Server starting on port 5000...")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}