package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type Claims struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	jwt.RegisteredClaims
}

func init() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key-change-in-production"
	}
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	err = db.Ping()
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		return err
	}

	return nil
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password + appSecret))
	return hex.EncodeToString(hash[:])
}

func verifyPassword(password, hash string) bool {
	return hashPassword(password) == hash
}

func generateToken(email, name string) (string, error) {
	claims := Claims{
		Email: email,
		Name:  name,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func validateEmail(email string) bool {
	if len(email) == 0 || len(email) > 254 {
		return false
	}
	if !strings.Contains(email, "@") {
		return false
	}
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return false
	}
	if len(parts[0]) == 0 || len(parts[1]) == 0 {
		return false
	}
	if !strings.Contains(parts[1], ".") {
		return false
	}
	return true
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Invalid request format",
		})
	}

	if !validateEmail(req.Email) {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	if len(req.Password) == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	var storedHash, name string
	err := db.QueryRow("SELECT password_hash, name FROM users WHERE email = ?", req.Email).Scan(&storedHash, &name)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
				Message: "Invalid email or password",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Internal server error",
		})
	}

	if !verifyPassword(req.Password, storedHash) {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	token, err := generateToken(req.Email, name)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Invalid request format",
		})
	}

	if !validateEmail(req.Email) {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	if len(req.Password) < 6 {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	if len(req.Name) == 0 || len(req.Name) > 255 {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	passwordHash := hashPassword(req.Password)

	_, err := db.Exec("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)", req.Email, passwordHash, req.Name)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
				Message: "Email already in use or invalid data",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Internal server error",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(MessageResponse{
		Message: "Registration successful",
	})
}

func main() {
	err := initDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Database initialization failed: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
				Message: "Internal server error",
			})
		},
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Content-Type,Authorization",
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/login", login)
	app.Post("/register", register)

	err = app.Listen("0.0.0.0:5000")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Server failed to start: %v\n", err)
		os.Exit(1)
	}
}