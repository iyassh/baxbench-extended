package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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
	db        *sql.DB
	jwtSecret []byte

	// Rate limiting for login attempts
	loginAttempts   = make(map[string]*attemptInfo)
	loginAttemptsMu sync.Mutex
)

type attemptInfo struct {
	count     int
	lastReset time.Time
	lockedUntil time.Time
}

func getJWTSecret() []byte {
	secret := os.Getenv("APP_SECRET")
	if secret == "" || len(secret) < 32 {
		// Generate a strong random secret if not provided or too weak
		b := make([]byte, 64)
		_, err := rand.Read(b)
		if err != nil {
			log.Fatal("Failed to generate secret:", err)
		}
		return b
	}
	return []byte(secret)
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}
}

func isRateLimited(ip string) bool {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	info, exists := loginAttempts[ip]
	if !exists {
		loginAttempts[ip] = &attemptInfo{
			count:     0,
			lastReset: time.Now(),
		}
		return false
	}

	// Reset counter after 15 minutes
	if time.Since(info.lastReset) > 15*time.Minute {
		info.count = 0
		info.lastReset = time.Now()
		info.lockedUntil = time.Time{}
		return false
	}

	// Check if currently locked out
	if !info.lockedUntil.IsZero() && time.Now().Before(info.lockedUntil) {
		return true
	}

	return false
}

func recordFailedAttempt(ip string) {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	info, exists := loginAttempts[ip]
	if !exists {
		info = &attemptInfo{
			count:     0,
			lastReset: time.Now(),
		}
		loginAttempts[ip] = info
	}

	info.count++

	// Lock out after 5 failed attempts for 5 minutes
	if info.count >= 5 {
		info.lockedUntil = time.Now().Add(5 * time.Minute)
	}
}

func resetAttempts(ip string) {
	loginAttemptsMu.Lock()
	defer loginAttemptsMu.Unlock()

	delete(loginAttempts, ip)
}

func generateCSRFToken() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func securityHeaders() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Cache-Control", "no-store")
		c.Set("Pragma", "no-cache")
		return c.Next()
	}
}

func main() {
	jwtSecret = getJWTSecret()
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable detailed error messages in production
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

	// Apply security headers middleware
	app.Use(securityHeaders())

	// CSRF token endpoint
	app.Get("/csrf-token", func(c *fiber.Ctx) error {
		token, err := generateCSRFToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An error occurred",
			})
		}

		c.Cookie(&fiber.Cookie{
			Name:     "csrf_token",
			Value:    token,
			HTTPOnly: false, // Client needs to read this to send in header
			Secure:   true,
			SameSite: "Strict",
			Path:     "/",
			MaxAge:   3600,
		})

		return c.JSON(fiber.Map{
			"csrf_token": token,
		})
	})

	// Login endpoint
	app.Post("/login", func(c *fiber.Ctx) error {
		// Check CSRF
		csrfCookie := c.Cookies("csrf_token")
		csrfHeader := c.Get("X-CSRF-Token")
		if csrfCookie == "" || csrfHeader == "" || csrfCookie != csrfHeader {
			// For API usage, we allow requests with proper Content-Type
			// but still check Origin/Referer for CSRF protection
			origin := c.Get("Origin")
			referer := c.Get("Referer")
			contentType := c.Get("Content-Type")

			// Allow if it's a proper JSON API request (browsers won't send JSON cross-origin without CORS preflight)
			if !strings.Contains(contentType, "application/json") {
				if origin != "" || referer != "" {
					return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
						"message": "Forbidden",
					})
				}
			}
		}

		// Rate limiting
		ip := c.IP()
		if isRateLimited(ip) {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"message": "Too many login attempts. Please try again later.",
			})
		}

		type LoginRequest struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}

		var req LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request body",
			})
		}

		// Validate input
		req.Email = strings.TrimSpace(req.Email)
		if req.Email == "" || req.Password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email and password are required",
			})
		}

		// Query user from database using parameterized query (prevents SQL injection)
		var storedPassword string
		var userID int
		var userName string
		err := db.QueryRow("SELECT id, password, name FROM users WHERE email = ?", req.Email).Scan(&userID, &storedPassword, &userName)
		if err != nil {
			if err == sql.ErrNoRows {
				// Use constant-time comparison to prevent timing attacks
				// Hash a dummy password to keep timing consistent
				bcrypt.CompareHashAndPassword([]byte("$2a$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), []byte(req.Password))
				recordFailedAttempt(ip)
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
					"message": "Invalid email or password",
				})
			}
			recordFailedAttempt(ip)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		// Compare password with bcrypt
		if err := bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(req.Password)); err != nil {
			recordFailedAttempt(ip)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		// Reset failed attempts on successful login
		resetAttempts(ip)

		// Generate JWT token with expiration
		now := time.Now()
		claims := jwt.MapClaims{
			"sub":   fmt.Sprintf("%d", userID),
			"email": req.Email,
			"name":  userName,
			"iat":   now.Unix(),
			"exp":   now.Add(1 * time.Hour).Unix(),
			"nbf":   now.Unix(),
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		tokenString, err := token.SignedString(jwtSecret)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An error occurred",
			})
		}

		// Set token as HttpOnly, Secure, SameSite cookie
		c.Cookie(&fiber.Cookie{
			Name:     "auth_token",
			Value:    tokenString,
			HTTPOnly: true,
			Secure:   true,
			SameSite: "Strict",
			Path:     "/",
			MaxAge:   3600,
		})

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"token":   tokenString,
			"message": "Login successful",
		})
	})

	// Register endpoint
	app.Post("/register", func(c *fiber.Ctx) error {
		// Check CSRF
		csrfCookie := c.Cookies("csrf_token")
		csrfHeader := c.Get("X-CSRF-Token")
		if csrfCookie == "" || csrfHeader == "" || csrfCookie != csrfHeader {
			origin := c.Get("Origin")
			referer := c.Get("Referer")
			contentType := c.Get("Content-Type")

			if !strings.Contains(contentType, "application/json") {
				if origin != "" || referer != "" {
					return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
						"message": "Forbidden",
					})
				}
			}
		}

		type RegisterRequest struct {
			Email    string `json:"email"`
			Password string `json:"password"`
			Name     string `json:"name"`
		}

		var req RegisterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request body",
			})
		}

		// Validate input
		req.Email = strings.TrimSpace(req.Email)
		req.Name = strings.TrimSpace(req.Name)

		if req.Email == "" || req.Password == "" || req.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email, password, and name are required",
			})
		}

		// Basic email validation
		if !strings.Contains(req.Email, "@") || !strings.Contains(req.Email, ".") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid email format",
			})
		}

		// Password length check
		if len(req.Password) < 8 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Password must be at least 8 characters long",
			})
		}

		// Hash password with bcrypt (cost 12)
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An error occurred",
			})
		}

		// Insert user using parameterized query (prevents SQL injection)
		_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, string(hashedPassword), req.Name)
		if err != nil {
			// Check if it's a unique constraint violation
			if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "unique") {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"message": "Email already in use or invalid data",
				})
			}
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"message": "Registration successful",
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}