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
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

// Rate limiting structures
type rateLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
}

var loginLimiter = &rateLimiter{
	attempts: make(map[string][]time.Time),
}

func (rl *rateLimiter) isAllowed(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	windowDuration := 5 * time.Minute
	maxAttempts := 10

	// Clean old attempts
	var recent []time.Time
	for _, t := range rl.attempts[key] {
		if now.Sub(t) < windowDuration {
			recent = append(recent, t)
		}
	}
	rl.attempts[key] = recent

	if len(recent) >= maxAttempts {
		return false
	}

	rl.attempts[key] = append(rl.attempts[key], now)
	return true
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		secret TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}

	return nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	c.Set("Cache-Control", "no-store")
	return c.Next()
}

func jwtMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenStr := parts[1]

	// Parse with explicit algorithm validation to prevent 'none' algorithm attack
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		// Strictly enforce HMAC signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{"HS256"}))

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Validate expiration
	exp, err := claims.GetExpirationTime()
	if err != nil || exp == nil || exp.Before(time.Now()) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	username, ok := claims["username"].(string)
	if !ok || username == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("username", username)
	return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request data",
		})
	}

	// Validate inputs
	if body.Email == "" || body.Username == "" || body.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email, username, and password are required",
		})
	}

	if len(body.Password) < 6 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Password must be at least 6 characters",
		})
	}

	// Hash password with bcrypt
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Registration failed",
		})
	}

	// Use parameterized query to prevent SQL injection
	_, err = db.Exec(
		"INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
		body.Email, body.Username, string(hash),
	)
	if err != nil {
		// Don't expose internal error details
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func loginHandler(c *fiber.Ctx) error {
	// Rate limiting by IP
	ip := c.IP()
	if !loginLimiter.isAllowed(ip) {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"message": "Too many login attempts, please try again later",
		})
	}

	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if body.Email == "" || body.Password == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Use parameterized query
	var username, passwordHash string
	err := db.QueryRow(
		"SELECT username, password_hash FROM users WHERE email = ?",
		body.Email,
	).Scan(&username, &passwordHash)

	if err != nil {
		// Use constant time comparison to avoid timing attacks
		// Still run bcrypt to prevent timing-based user enumeration
		bcrypt.CompareHashAndPassword([]byte("$2a$10$dummyhashfordummycomparison12345"), []byte(body.Password))
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(body.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Create JWT token with expiration
	now := time.Now()
	claims := jwt.MapClaims{
		"username": username,
		"iat":      now.Unix(),
		"exp":      now.Add(24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Login failed",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   tokenStr,
		"message": "Login successful",
	})
}

func setSecretHandler(c *fiber.Ctx) error {
	// Get authenticated username from JWT
	authUsername := c.Locals("username").(string)

	var body struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request data",
		})
	}

	if body.Username == "" || body.Secret == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username and secret are required",
		})
	}

	// Authorization check: ensure the token's username matches the requested username
	if authUsername != body.Username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Use parameterized query with upsert
	_, err := db.Exec(
		`INSERT INTO secrets (username, secret, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(username) DO UPDATE SET secret = excluded.secret, updated_at = CURRENT_TIMESTAMP`,
		body.Username, body.Secret,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to set secret",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecretHandler(c *fiber.Ctx) error {
	// Get authenticated username from JWT
	authUsername := c.Locals("username").(string)

	username := c.Query("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username is required",
		})
	}

	// Authorization check: ensure the token's username matches the requested username
	if authUsername != username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Use parameterized query
	var secret string
	err := db.QueryRow(
		"SELECT secret FROM secrets WHERE username = ?",
		username,
	).Scan(&secret)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"message": "No secret found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to retrieve secret",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"secret": secret,
	})
}

func main() {
	// Get app secret from environment
	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}

	if len(appSecret) < 32 {
		log.Fatal("APP_SECRET must be at least 32 characters for security")
	}

	jwtSecret = []byte(appSecret)

	// Initialize database
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable error details in production
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			var e *fiber.Error
			if errors.As(err, &e) {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"message": "An error occurred",
			})
		},
	})

	// Apply security headers to all routes
	app.Use(securityHeaders)

	// Public routes
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)

	// Protected routes
	app.Post("/set_secret", jwtMiddleware, setSecretHandler)
	app.Get("/get_secret", jwtMiddleware, getSecretHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}