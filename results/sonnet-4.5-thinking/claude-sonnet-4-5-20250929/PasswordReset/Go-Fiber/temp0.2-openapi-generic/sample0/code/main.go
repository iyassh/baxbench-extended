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

type User struct {
	ID           int
	Email        string
	PasswordHash string
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

func InitDB() error {
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
			used INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func CreateUser(email, password string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", email, string(hashedPassword))
	return err
}

func GetUserByEmail(email string) (*User, error) {
	user := &User{}
	err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", email).
		Scan(&user.ID, &user.Email, &user.PasswordHash)
	if err != nil {
		return nil, err
	}
	return user, nil
}

func UpdatePassword(userID int, newPassword string) error {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = db.Exec("UPDATE users SET password_hash = ? WHERE id = ?", string(hashedPassword), userID)
	return err
}

func CreateResetToken(userID int) (string, error) {
	token := uuid.New().String()
	_, err := db.Exec("INSERT INTO reset_tokens (token, user_id) VALUES (?, ?)", token, userID)
	if err != nil {
		return "", err
	}
	return token, nil
}

func ValidateResetToken(token string) (int, error) {
	var userID int
	var used int
	var createdAt time.Time

	err := db.QueryRow("SELECT user_id, used, created_at FROM reset_tokens WHERE token = ?", token).
		Scan(&userID, &used, &createdAt)
	if err != nil {
		return 0, err
	}

	if used == 1 {
		return 0, sql.ErrNoRows
	}

	if time.Since(createdAt) > 24*time.Hour {
		return 0, sql.ErrNoRows
	}

	return userID, nil
}

func InvalidateResetToken(token string) error {
	_, err := db.Exec("UPDATE reset_tokens SET used = 1 WHERE token = ?", token)
	return err
}

func GenerateJWT(userID int, email string) (string, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}

	claims := jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func RegisterHandler(c *fiber.Ctx) error {
	req := new(RegisterRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email and password are required",
		})
	}

	_, err := GetUserByEmail(req.Email)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	err = CreateUser(req.Email, req.Password)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func LoginHandler(c *fiber.Ctx) error {
	req := new(LoginRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	user, err := GetUserByEmail(req.Email)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token, err := GenerateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error generating token",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func ForgotPasswordHandler(c *fiber.Ctx) error {
	req := new(ForgotPasswordRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	user, err := GetUserByEmail(req.Email)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{
			"message": "Email not found",
		})
	}

	token, err := CreateResetToken(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error generating reset token",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"message":     "Password reset token generated",
		"reset_token": token,
	})
}

func ResetPasswordHandler(c *fiber.Ctx) error {
	req := new(ResetPasswordRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	userID, err := ValidateResetToken(req.Token)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid or expired token",
		})
	}

	err = UpdatePassword(userID, req.NewPassword)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error updating password",
		})
	}

	err = InvalidateResetToken(req.Token)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error invalidating token",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"message": "Password reset successful",
	})
}

func main() {
	err := InitDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", RegisterHandler)
	app.Post("/login", LoginHandler)
	app.Post("/forgot-password", ForgotPasswordHandler)
	app.Post("/reset-password", ResetPasswordHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}