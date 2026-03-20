package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var (
	db              *sql.DB
	jwtSecret       []byte
	loginAttempts   = make(map[string][]time.Time)
	loginAttemptsMu sync.Mutex
)

type RegisterRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SetSecretRequest struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

type Claims struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

func init() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable not set")
	}
	jwtSecret = []byte(secret)

	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables()
}

func createTables() {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS secrets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			secret TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users (id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_secrets_user_id ON secrets(user_id)`,
	}

	for _, query := range queries {
		if _, err := db.Exec(query); err != nil {
			log.Fatal(err)
		}
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	return c.Next()
}

func checkRateLimit(email string) bool {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	now := time.Now()
	attempts := loginAttempts[email]
	
	var validAttempts []time.Time
	for _, attempt := range attempts {
		if now.Sub(attempt) < 15*time.Minute {
			validAttempts = append(validAttempts, attempt)
		}
	}
	
	loginAttempts[email] = validAttempts
	
	if len(validAttempts) >= 5 {
		return false
	}
	
	loginAttempts[email] = append(loginAttempts[email], now)
	return true
}

func jwtAuth(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	if tokenString == authHeader {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if token.Method.Alg() == "none" {
			return nil, fmt.Errorf("none algorithm not allowed")
		}
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	c.Locals("claims", claims)
	return c.Next()
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"message": "An error occurred"})
		},
	})

	app.Use(securityHeaders)

	app.Post("/register", func(c *fiber.Ctx) error {
		var req RegisterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
		}

		if req.Email == "" || req.Username == "" || req.Password == "" {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
		}

		if !strings.Contains(req.Email, "@") {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Registration failed"})
		}

		_, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
			req.Email, req.Username, hashedPassword)
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint failed") {
				return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
			}
			return c.Status(500).JSON(fiber.Map{"message": "Registration failed"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
	})

	app.Post("/login", func(c *fiber.Ctx) error {
		var req LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		if !checkRateLimit(req.Email) {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		var userID int
		var username, passwordHash string
		err := db.QueryRow("SELECT id, username, password_hash FROM users WHERE email = ?", req.Email).
			Scan(&userID, &username, &passwordHash)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		claims := Claims{
			UserID:   userID,
			Username: username,
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
			},
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		tokenString, err := token.SignedString(jwtSecret)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Login failed"})
		}

		return c.JSON(fiber.Map{
			"token":   tokenString,
			"message": "Login successful",
		})
	})

	app.Post("/set_secret", jwtAuth, func(c *fiber.Ctx) error {
		claims := c.Locals("claims").(*Claims)

		var req SetSecretRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
		}

		if req.Username != claims.Username {
			return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Failed to set secret"})
		}
		defer tx.Rollback()

		_, err = tx.Exec("DELETE FROM secrets WHERE user_id = ?", claims.UserID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Failed to set secret"})
		}

		_, err = tx.Exec("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", claims.UserID, req.Secret)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Failed to set secret"})
		}

		if err = tx.Commit(); err != nil {
			return c.Status(500).JSON(fiber.Map{"message": "Failed to set secret"})
		}

		return c.JSON(fiber.Map{"message": "Secret has been set successfully"})
	})

	app.Get("/get_secret", jwtAuth, func(c *fiber.Ctx) error {
		claims := c.Locals("claims").(*Claims)
		username := c.Query("username")

		if username != claims.Username {
			return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
		}

		var secret string
		err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", 
			claims.UserID).Scan(&secret)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.JSON(fiber.Map{"secret": ""})
			}
			return c.Status(500).JSON(fiber.Map{"message": "Failed to retrieve secret"})
		}

		return c.JSON(fiber.Map{"secret": secret})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}