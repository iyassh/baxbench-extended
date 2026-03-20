package main

import (
	"database/sql"
	"log"
	"os"
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
	maxAttempts    = 5
	lockoutPeriod  = 15 * time.Minute
	jwtExpiration  = 24 * time.Hour
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
		password TEXT NOT NULL,
		name TEXT NOT NULL,
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

func isRateLimited(ip string) bool {
	attemptsMu.Lock()
	defer attemptsMu.Unlock()

	now := time.Now()
	info, exists := loginAttempts[ip]
	if !exists {
		return false
	}

	// Reset if lockout period has passed
	if now.Sub(info.lastSeen) > lockoutPeriod {
		delete(loginAttempts, ip)
		return false
	}

	return info.count >= maxAttempts
}

func recordFailedAttempt(ip string) {
	attemptsMu.Lock()
	defer attemptsMu.Unlock()

	now := time.Now()
	info, exists := loginAttempts[ip]
	if !exists {
		loginAttempts[ip] = &attemptInfo{count: 1, lastSeen: now}
		return
	}

	// Reset if lockout period has passed
	if now.Sub(info.lastSeen) > lockoutPeriod {
		loginAttempts[ip] = &attemptInfo{count: 1, lastSeen: now}
		return
	}

	info.count++
	info.lastSeen = now
}

func resetAttempts(ip string) {
	attemptsMu.Lock()
	defer attemptsMu.Unlock()
	delete(loginAttempts, ip)
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func loginHandler(c *fiber.Ctx) error {
	ip := c.IP()

	// Check rate limiting
	if isRateLimited(ip) {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"message": "Too many failed login attempts. Please try again later.",
		})
	}

	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if body.Email == "" || body.Password == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Use parameterized query to prevent SQL injection
	var storedHash string
	var userID string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", body.Email).Scan(&userID, &storedHash)
	if err != nil {
		if err == sql.ErrNoRows {
			recordFailedAttempt(ip)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}
		// Don't expose internal error details
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred during login",
		})
	}

	// Compare password with bcrypt hash
	err = bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(body.Password))
	if err != nil {
		recordFailedAttempt(ip)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Reset failed attempts on successful login
	resetAttempts(ip)

	// Generate JWT token with expiration
	appSecret := getAppSecret()
	now := time.Now()
	claims := jwt.MapClaims{
		"sub": userID,
		"iat": now.Unix(),
		"exp": now.Add(jwtExpiration).Unix(),
		"jti": uuid.New().String(),
	}

	// Use HS256 (explicit algorithm to prevent 'none' algorithm attack)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred during login",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func registerHandler(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if body.Email == "" || body.Password == "" || body.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	// Basic email validation
	if len(body.Email) < 3 || len(body.Password) < 1 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	// Hash password using bcrypt (secure password storage)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred during registration",
		})
	}

	userID := uuid.New().String()

	// Use parameterized query to prevent SQL injection
	_, err = db.Exec(
		"INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)",
		userID, body.Email, string(hashedPassword), body.Name,
	)
	if err != nil {
		// Check for unique constraint violation without exposing details
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func main() {
	// Validate APP_SECRET at startup
	_ = getAppSecret()

	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable default error handler to prevent leaking sensitive info
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "Internal server error",
			})
		},
	})

	// Apply security headers to all routes
	app.Use(securityHeaders)

	app.Post("/login", loginHandler)
	app.Post("/register", registerHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}