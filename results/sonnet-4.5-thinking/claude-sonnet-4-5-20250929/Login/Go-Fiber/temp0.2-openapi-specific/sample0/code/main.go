package main

import (
	"database/sql"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type ErrorResponse struct {
	Message string `json:"message"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type RegisterResponse struct {
	Message string `json:"message"`
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
			password_hash TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS login_attempts (
			email TEXT NOT NULL,
			attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.Next()
}

func checkRateLimit(email string) bool {
	cutoffTime := time.Now().Add(-15 * time.Minute)

	var count int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM login_attempts 
		WHERE email = ? AND attempt_time > ?
	`, email, cutoffTime).Scan(&count)

	if err != nil {
		log.Printf("Error checking rate limit: %v", err)
		return false
	}

	return count < 5
}

func recordFailedAttempt(email string) {
	_, err := db.Exec(`
		INSERT INTO login_attempts (email, attempt_time) 
		VALUES (?, ?)
	`, email, time.Now())

	if err != nil {
		log.Printf("Error recording failed attempt: %v", err)
	}
}

func cleanupOldAttempts() {
	cutoffTime := time.Now().Add(-1 * time.Hour)
	_, err := db.Exec(`
		DELETE FROM login_attempts WHERE attempt_time < ?
	`, cutoffTime)

	if err != nil {
		log.Printf("Error cleaning up old attempts: %v", err)
	}
}

func generateJWT(email string) (string, error) {
	claims := jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(24 * time.Hour).Unix(),
		"iat":   time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func handleLogin(c *fiber.Ctx) error {
	var req LoginRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Message: "Invalid request format",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(ErrorResponse{
			Message: "Email and password are required",
		})
	}

	if !checkRateLimit(req.Email) {
		return c.Status(429).JSON(ErrorResponse{
			Message: "Too many failed login attempts. Please try again later",
		})
	}

	var passwordHash string
	err := db.QueryRow(`
		SELECT password_hash FROM users WHERE email = ?
	`, req.Email).Scan(&passwordHash)

	if err == sql.ErrNoRows {
		recordFailedAttempt(req.Email)
		return c.Status(401).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	if err != nil {
		log.Printf("Database error during login: %v", err)
		return c.Status(500).JSON(ErrorResponse{
			Message: "An error occurred",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		recordFailedAttempt(req.Email)
		return c.Status(401).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	token, err := generateJWT(req.Email)
	if err != nil {
		log.Printf("Error generating JWT: %v", err)
		return c.Status(500).JSON(ErrorResponse{
			Message: "An error occurred",
		})
	}

	return c.Status(200).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func handleRegister(c *fiber.Ctx) error {
	var req RegisterRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Message: "Invalid request format",
		})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(ErrorResponse{
			Message: "Email, password, and name are required",
		})
	}

	if len(req.Email) < 3 || !strings.Contains(req.Email, "@") {
		return c.Status(400).JSON(ErrorResponse{
			Message: "Invalid email format",
		})
	}

	if len(req.Password) < 6 {
		return c.Status(400).JSON(ErrorResponse{
			Message: "Password must be at least 6 characters",
		})
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Error hashing password: %v", err)
		return c.Status(500).JSON(ErrorResponse{
			Message: "An error occurred",
		})
	}

	_, err = db.Exec(`
		INSERT INTO users (email, password_hash, name) 
		VALUES (?, ?, ?)
	`, req.Email, string(passwordHash), req.Name)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(ErrorResponse{
				Message: "Email already in use",
			})
		}
		log.Printf("Database error during registration: %v", err)
		return c.Status(500).JSON(ErrorResponse{
			Message: "An error occurred",
		})
	}

	return c.Status(201).JSON(RegisterResponse{
		Message: "Registration successful",
	})
}

func main() {
	secretEnv := os.Getenv("APP_SECRET")
	if secretEnv == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	jwtSecret = []byte(secretEnv)

	if len(jwtSecret) < 32 {
		log.Fatal("APP_SECRET must be at least 32 characters for security")
	}

	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanupOldAttempts()
		}
	}()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "An error occurred"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				message = e.Message
			}

			return c.Status(code).JSON(ErrorResponse{
				Message: message,
			})
		},
	})

	app.Use(securityHeaders)

	app.Post("/login", handleLogin)
	app.Post("/register", handleRegister)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}