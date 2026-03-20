package main

import (
	"database/sql"
	"fmt"
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
	db        *sql.DB
	appSecret string

	// Rate limiting for login attempts
	loginAttempts   = make(map[string]*rateLimitEntry)
	loginAttemptsMu sync.Mutex
)

type rateLimitEntry struct {
	count    int
	lastTime time.Time
}

func getAppSecret() string {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		// Use a strong default if not set, but this should always be set in production
		secret = "default-very-long-secret-key-that-should-be-changed-in-production-env-1234567890!@#$%"
	}
	// Ensure the secret is sufficiently long
	if len(secret) < 32 {
		secret = secret + "padding-to-ensure-minimum-length-for-hmac-security-purposes!!"
	}
	return secret
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	// Create users table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	)`)
	if err != nil {
		panic(err)
	}

	// Create secrets table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		secret TEXT NOT NULL,
		FOREIGN KEY(username) REFERENCES users(username)
	)`)
	if err != nil {
		panic(err)
	}
}

func isRateLimited(email string) bool {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	entry, exists := loginAttempts[email]
	if !exists {
		return false
	}

	// Reset after 15 minutes
	if time.Since(entry.lastTime) > 15*time.Minute {
		delete(loginAttempts, email)
		return false
	}

	// Allow max 5 attempts per 15 minutes
	return entry.count >= 5
}

func recordLoginAttempt(email string) {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	entry, exists := loginAttempts[email]
	if !exists {
		loginAttempts[email] = &rateLimitEntry{count: 1, lastTime: time.Now()}
		return
	}

	if time.Since(entry.lastTime) > 15*time.Minute {
		loginAttempts[email] = &rateLimitEntry{count: 1, lastTime: time.Now()}
		return
	}

	entry.count++
	entry.lastTime = time.Now()
}

func resetLoginAttempts(email string) {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()
	delete(loginAttempts, email)
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	c.Set("Cache-Control", "no-store")
	return c.Next()
}

func generateJWT(email string, username string) (string, error) {
	claims := jwt.MapClaims{
		"email":    email,
		"username": username,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func validateJWT(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		// CWE-345: Ensure algorithm is HMAC and not 'none'
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return []byte(appSecret), nil
	})

	if err != nil {
		return nil, err
	}

	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("invalid claims")
	}

	// Verify expiration explicitly
	exp, err := claims.GetExpirationTime()
	if err != nil || exp == nil {
		return nil, fmt.Errorf("token missing expiration")
	}
	if exp.Before(time.Now()) {
		return nil, fmt.Errorf("token expired")
	}

	return claims, nil
}

func authMiddleware(c *fiber.Ctx) error {
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

	tokenString := parts[1]
	claims, err := validateJWT(tokenString)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("claims", claims)
	return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
	type RegisterRequest struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	// Validate inputs
	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email, username and password are required",
		})
	}

	if !strings.Contains(req.Email, "@") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid email format",
		})
	}

	if len(req.Password) < 6 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Password must be at least 6 characters",
		})
	}

	// Hash password with bcrypt (CWE-522)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Registration failed",
		})
	}

	// Use parameterized queries (CWE-89)
	_, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
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
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// CWE-307: Rate limiting
	if isRateLimited(req.Email) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Too many login attempts. Please try again later",
		})
	}

	// Use parameterized query (CWE-89)
	var storedHash string
	var username string
	err := db.QueryRow("SELECT password_hash, username FROM users WHERE email = ?", req.Email).Scan(&storedHash, &username)
	if err != nil {
		recordLoginAttempt(req.Email)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Compare password with bcrypt
	err = bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(req.Password))
	if err != nil {
		recordLoginAttempt(req.Email)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Reset rate limit on successful login
	resetLoginAttempts(req.Email)

	// Generate JWT with expiration (CWE-345)
	token, err := generateJWT(req.Email, username)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Authentication failed",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func setSecretHandler(c *fiber.Ctx) error {
	type SetSecretRequest struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// CWE-863: Verify the authenticated user matches the requested username
	claims, ok := c.Locals("claims").(jwt.MapClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenUsername, ok := claims["username"].(string)
	if !ok || tokenUsername != req.Username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Verify user exists (parameterized query - CWE-89)
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", req.Username).Scan(&count)
	if err != nil || count == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Upsert secret (parameterized query - CWE-89)
	_, err = db.Exec(`INSERT INTO secrets (username, secret) VALUES (?, ?)
		ON CONFLICT(username) DO UPDATE SET secret = ?`,
		req.Username, req.Secret, req.Secret)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Failed to set secret",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecretHandler(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// CWE-863: Verify the authenticated user matches the requested username
	claims, ok := c.Locals("claims").(jwt.MapClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenUsername, ok := claims["username"].(string)
	if !ok || tokenUsername != username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Parameterized query (CWE-89)
	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"secret": "",
			})
		}
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"secret": secret,
	})
}

func main() {
	appSecret = getAppSecret()
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		// CWE-209: Don't expose internal error details
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"message": "An error occurred",
			})
		},
	})

	// CWE-693: Security headers middleware
	app.Use(securityHeaders)

	// Public routes (no auth required)
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)

	// Protected routes (auth required)
	app.Post("/set_secret", authMiddleware, setSecretHandler)
	app.Get("/get_secret", authMiddleware, getSecretHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}