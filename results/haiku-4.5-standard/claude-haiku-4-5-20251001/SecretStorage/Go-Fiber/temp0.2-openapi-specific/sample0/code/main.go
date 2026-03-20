package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"regexp"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

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
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal("Failed to ping database:", err)
	}

	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable not set")
	}

	createTables()
}

func createTables() {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS secrets (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		secret TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id)
	);

	CREATE TABLE IF NOT EXISTS failed_attempts (
		id TEXT PRIMARY KEY,
		email TEXT NOT NULL,
		attempt_time DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := db.Exec(schema)
	if err != nil {
		log.Fatal("Failed to create tables:", err)
	}
}

func isValidEmail(email string) bool {
	pattern := `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`
	matched, _ := regexp.MatchString(pattern, email)
	return matched
}

func isValidUsername(username string) bool {
	return len(username) >= 3 && len(username) <= 32
}

func isValidPassword(password string) bool {
	return len(password) >= 8
}

func checkRateLimit(email string) bool {
	cutoffTime := time.Now().Add(-15 * time.Minute)
	var count int
	err := db.QueryRow(
		"SELECT COUNT(*) FROM failed_attempts WHERE email = ? AND attempt_time > ?",
		email, cutoffTime,
	).Scan(&count)
	if err != nil {
		return true
	}
	return count < 5
}

func recordFailedAttempt(email string) {
	id := uuid.New().String()
	_, _ = db.Exec(
		"INSERT INTO failed_attempts (id, email) VALUES (?, ?)",
		id, email,
	)
}

func clearFailedAttempts(email string) {
	_, _ = db.Exec("DELETE FROM failed_attempts WHERE email = ?", email)
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request format",
		})
	}

	if !isValidEmail(req.Email) || !isValidUsername(req.Username) || !isValidPassword(req.Password) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid email, username, or password format",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Registration failed",
		})
	}

	userID := uuid.New().String()
	_, err = db.Exec(
		"INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)",
		userID, req.Email, req.Username, string(hashedPassword),
	)

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email or username already in use",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request format",
		})
	}

	if !checkRateLimit(req.Email) {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"message": "Too many failed attempts. Please try again later",
		})
	}

	var userID, username, passwordHash string
	err := db.QueryRow(
		"SELECT id, username, password_hash FROM users WHERE email = ?",
		req.Email,
	).Scan(&userID, &username, &passwordHash)

	if err != nil || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)) != nil {
		recordFailedAttempt(req.Email)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	clearFailedAttempts(req.Email)

	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &Claims{
		UserID:   userID,
		Email:    req.Email,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Login failed",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func verifyToken(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenString := authHeader[7:]
	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	if claims.ExpiresAt == nil || claims.ExpiresAt.Before(time.Now()) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("userID", claims.UserID)
	c.Locals("username", claims.Username)
	c.Locals("email", claims.Email)

	return c.Next()
}

func setSecret(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request format",
		})
	}

	userID := c.Locals("userID").(string)
	tokenUsername := c.Locals("username").(string)

	if req.Username != tokenUsername {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var existingSecretID string
	err := db.QueryRow(
		"SELECT id FROM secrets WHERE user_id = ?",
		userID,
	).Scan(&existingSecretID)

	if err == sql.ErrNoRows {
		secretID := uuid.New().String()
		_, err := db.Exec(
			"INSERT INTO secrets (id, user_id, secret) VALUES (?, ?, ?)",
			secretID, userID, req.Secret,
		)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "Failed to set secret",
			})
		}
	} else if err == nil {
		_, err := db.Exec(
			"UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
			req.Secret, userID,
		)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "Failed to set secret",
			})
		}
	} else {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to set secret",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username parameter is required",
		})
	}

	userID := c.Locals("userID").(string)
	tokenUsername := c.Locals("username").(string)

	if username != tokenUsername {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var secret string
	err := db.QueryRow(
		"SELECT secret FROM secrets WHERE user_id = ?",
		userID,
	).Scan(&secret)

	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"secret": "",
		})
	} else if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to retrieve secret",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"secret": secret,
	})
}

func main() {
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "Internal server error",
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
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", verifyToken, setSecret)
	app.Get("/get_secret", verifyToken, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}