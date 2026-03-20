package main

import (
	"database/sql"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

// Rate limiting structures
type attemptInfo struct {
	count    int
	lastSeen time.Time
}

var (
	loginAttempts = make(map[string]*attemptInfo)
	attemptsMu    sync.Mutex
)

const (
	maxAttempts     = 5
	lockoutDuration = 15 * time.Minute
)

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}
}

func getAppSecret() string {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable is not set")
	}
	if len(secret) < 32 {
		log.Fatal("APP_SECRET must be at least 32 characters long")
	}
	return secret
}

func checkRateLimit(email string) bool {
	attemptsMu.Lock()
	defer attemptsMu.Unlock()

	now := time.Now()
	info, exists := loginAttempts[email]
	if !exists {
		loginAttempts[email] = &attemptInfo{count: 1, lastSeen: now}
		return true
	}

	if now.Sub(info.lastSeen) > lockoutDuration {
		info.count = 1
		info.lastSeen = now
		return true
	}

	if info.count >= maxAttempts {
		return false
	}

	info.count++
	info.lastSeen = now
	return true
}

func resetRateLimit(email string) {
	attemptsMu.Lock()
	defer attemptsMu.Unlock()
	delete(loginAttempts, email)
}

func generateJWT(userID, email, secret string) (string, error) {
	claims := jwt.MapClaims{
		"sub":   userID,
		"email": email,
		"iat":   time.Now().Unix(),
		"exp":   time.Now().Add(24 * time.Hour).Unix(),
		"jti":   uuid.New().String(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func loginHandler(appSecret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var req struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}

		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request body",
			})
		}

		req.Email = strings.TrimSpace(strings.ToLower(req.Email))

		if req.Email == "" || req.Password == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		if !checkRateLimit(req.Email) {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"message": "Too many failed login attempts. Please try again later.",
			})
		}

		var userID, passwordHash string
		err := db.QueryRow(
			"SELECT id, password_hash FROM users WHERE email = ?",
			req.Email,
		).Scan(&userID, &passwordHash)

		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
					"message": "Invalid email or password",
				})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An internal error occurred",
			})
		}

		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		resetRateLimit(req.Email)

		token, err := generateJWT(userID, req.Email, appSecret)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An internal error occurred",
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"token":   token,
			"message": "Login successful",
		})
	}
}

func registerHandler(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	if len(req.Password) < 6 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	if !strings.Contains(req.Email, "@") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An internal error occurred",
		})
	}

	userID := uuid.New().String()

	_, err = db.Exec(
		"INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
		userID, req.Email, req.Name, string(passwordHash),
	)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An internal error occurred",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func main() {
	appSecret := getAppSecret()
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An internal error occurred",
			})
		},
	})

	app.Use(securityHeaders)

	app.Post("/login", loginHandler(appSecret))
	app.Post("/register", registerHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}