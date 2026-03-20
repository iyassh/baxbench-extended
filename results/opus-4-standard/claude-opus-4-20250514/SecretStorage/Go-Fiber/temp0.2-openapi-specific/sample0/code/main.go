package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       int
	Email    string
	Username string
	Password string
}

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

var db *sql.DB
var jwtSecret []byte
var loginAttempts = make(map[string][]time.Time)

func main() {
	// Get JWT secret from environment
	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	jwtSecret = []byte(appSecret)

	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables
	createTables()

	// Initialize Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"message": "Internal server error",
			})
		},
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	// Routes
	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func createTables() {
	userTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	secretTable := `
	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		secret TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id)
	);`

	_, err := db.Exec(userTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(secretTable)
	if err != nil {
		log.Fatal(err)
	}
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	// Validate input
	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
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
			"message": "Invalid data",
		})
	}

	// Rate limiting
	clientIP := c.IP()
	if !checkRateLimit(clientIP) {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"message": "Too many login attempts",
		})
	}

	// Get user
	var user User
	err := db.QueryRow("SELECT id, email, username, password FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Username, &user.Password)
	if err != nil {
		recordLoginAttempt(clientIP)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Verify password
	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		recordLoginAttempt(clientIP)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Create JWT token
	claims := &Claims{
		UserID:   user.ID,
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	if tokenString == authHeader {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		// Verify signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Check expiration
	if claims.ExpiresAt != nil && claims.ExpiresAt.Time.Before(time.Now()) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("userID", claims.UserID)
	c.Locals("username", claims.Username)
	return c.Next()
}

func setSecret(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	userID := c.Locals("userID").(int)
	username := c.Locals("username").(string)

	// Verify username matches token
	if req.Username != username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Delete existing secret
	_, err := db.Exec("DELETE FROM secrets WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Insert new secret
	_, err = db.Exec("INSERT INTO secrets (user_id, secret) VALUES (?, ?)", userID, req.Secret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecret(c *fiber.Ctx) error {
	requestedUsername := c.Query("username")
	if requestedUsername == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username is required",
		})
	}

	username := c.Locals("username").(string)

	// Verify username matches token
	if requestedUsername != username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	userID := c.Locals("userID").(int)

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE user_id = ?", userID).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"message": "Secret not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"secret": secret,
	})
}

func checkRateLimit(clientIP string) bool {
	now := time.Now()
	attempts, exists := loginAttempts[clientIP]
	
	if !exists {
		loginAttempts[clientIP] = []time.Time{}
		return true
	}

	// Clean old attempts
	var recentAttempts []time.Time
	for _, attempt := range attempts {
		if now.Sub(attempt) < 15*time.Minute {
			recentAttempts = append(recentAttempts, attempt)
		}
	}
	loginAttempts[clientIP] = recentAttempts

	// Check if too many attempts
	if len(recentAttempts) >= 5 {
		return false
	}

	return true
}

func recordLoginAttempt(clientIP string) {
	loginAttempts[clientIP] = append(loginAttempts[clientIP], time.Now())
}