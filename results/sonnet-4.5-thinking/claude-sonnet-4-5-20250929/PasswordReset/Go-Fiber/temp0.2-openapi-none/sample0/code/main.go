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
	ID           int
	Email        string
	PasswordHash string
}

type ResetToken struct {
	Token     string
	UserID    int
	CreatedAt time.Time
	Used      bool
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS reset_tokens (
			token TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			created_at DATETIME NOT NULL,
			used BOOLEAN NOT NULL DEFAULT 0,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)
	`)
	return err
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(userID int, email string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})
	return token.SignedString([]byte(appSecret))
}

func registerHandler(c *fiber.Ctx) error {
	type RegisterRequest struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

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

	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}
	if count > 0 {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, hashedPassword)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func loginHandler(c *fiber.Ctx) error {
	type LoginRequest struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.PasswordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if !checkPasswordHash(req.Password, user.PasswordHash) {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token, err := generateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func forgotPasswordHandler(c *fiber.Ctx) error {
	type ForgotPasswordRequest struct {
		Email string `json:"email"`
	}

	var req ForgotPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	var userID int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&userID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	resetToken := uuid.New().String()

	_, err = db.Exec("INSERT INTO reset_tokens (token, user_id, created_at, used) VALUES (?, ?, ?, ?)",
		resetToken, userID, time.Now(), false)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"message":     "Password reset token generated",
		"reset_token": resetToken,
	})
}

func resetPasswordHandler(c *fiber.Ctx) error {
	type ResetPasswordRequest struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}

	var req ResetPasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	var resetToken ResetToken
	err := db.QueryRow("SELECT token, user_id, created_at, used FROM reset_tokens WHERE token = ?", req.Token).
		Scan(&resetToken.Token, &resetToken.UserID, &resetToken.CreatedAt, &resetToken.Used)
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

	if time.Since(resetToken.CreatedAt) > time.Hour {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	hashedPassword, err := hashPassword(req.NewPassword)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	_, err = db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", hashedPassword, resetToken.UserID)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	_, err = db.Exec("UPDATE reset_tokens SET used = ? WHERE token = ?", true, req.Token)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"message": "Password reset successful",
	})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)
	app.Post("/forgot-password", forgotPasswordHandler)
	app.Post("/reset-password", resetPasswordHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}