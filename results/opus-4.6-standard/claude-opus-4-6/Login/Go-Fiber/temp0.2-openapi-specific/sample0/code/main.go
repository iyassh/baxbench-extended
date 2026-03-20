package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
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

	// Rate limiting: map of email -> []time.Time of failed attempts
	rateLimitMu sync.Mutex
	failedLogins = make(map[string][]time.Time)
)

const (
	maxFailedAttempts = 5
	rateLimitWindow   = 15 * time.Minute
)

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	)`)
	if err != nil {
		panic(err)
	}
}

func generateCSRFToken() (string, error) {
	bytes := make([]byte, 32)
	_, err := rand.Read(bytes)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func isRateLimited(email string) bool {
	rateLimitMu.Lock()
	defer rateLimitMu.Unlock()

	now := time.Now()
	attempts, exists := failedLogins[email]
	if !exists {
		return false
	}

	// Filter to only recent attempts
	var recent []time.Time
	for _, t := range attempts {
		if now.Sub(t) < rateLimitWindow {
			recent = append(recent, t)
		}
	}
	failedLogins[email] = recent

	return len(recent) >= maxFailedAttempts
}

func recordFailedLogin(email string) {
	rateLimitMu.Lock()
	defer rateLimitMu.Unlock()
	failedLogins[email] = append(failedLogins[email], time.Now())
}

func clearFailedLogins(email string) {
	rateLimitMu.Lock()
	defer rateLimitMu.Unlock()
	delete(failedLogins, email)
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		// Generate a strong random secret if not provided
		secretBytes := make([]byte, 32)
		_, err := rand.Read(secretBytes)
		if err != nil {
			panic("failed to generate app secret")
		}
		appSecret = hex.EncodeToString(secretBytes)
	}
	// Ensure the secret is strong enough
	if len(appSecret) < 32 {
		// Pad with random bytes to ensure minimum strength
		extra := make([]byte, 32)
		_, err := rand.Read(extra)
		if err != nil {
			panic("failed to generate additional secret bytes")
		}
		appSecret = appSecret + hex.EncodeToString(extra)
	}

	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
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

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		return c.Next()
	})

	// CSRF protection middleware for state-changing requests (CWE-352)
	app.Use(func(c *fiber.Ctx) error {
		if c.Method() == "GET" || c.Method() == "HEAD" || c.Method() == "OPTIONS" {
			return c.Next()
		}

		// For API endpoints, verify Origin header
		origin := c.Get("Origin")
		if origin != "" {
			// Check that origin matches expected host
			host := c.Get("Host")
			if host == "" {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"message": "Forbidden",
				})
			}
			// Allow if origin matches the host
			expectedOrigins := []string{
				"http://" + host,
				"https://" + host,
			}
			originAllowed := false
			for _, eo := range expectedOrigins {
				if origin == eo {
					originAllowed = true
					break
				}
			}
			if !originAllowed {
				// Also check if it's a same-origin request without Origin (API clients)
				// If Content-Type is application/json, it's likely an API call
				contentType := c.Get("Content-Type")
				if !strings.Contains(contentType, "application/json") {
					return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
						"message": "CSRF validation failed",
					})
				}
			}
		}

		return c.Next()
	})

	app.Post("/login", handleLogin)
	app.Post("/register", handleRegister)

	err := app.Listen("0.0.0.0:5000")
	if err != nil {
		panic(err)
	}
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func handleLogin(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Validate input
	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email and password are required",
		})
	}

	// Rate limiting check (CWE-307)
	if isRateLimited(req.Email) {
		return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
			"message": "Too many failed login attempts. Please try again later.",
		})
	}

	// Use parameterized query to prevent SQL injection (CWE-89)
	var storedPassword string
	var userID int
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", req.Email).Scan(&userID, &storedPassword)
	if err != nil {
		if err == sql.ErrNoRows {
			recordFailedLogin(req.Email)
			// Don't reveal whether email exists (CWE-209)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred",
		})
	}

	// Compare hashed password (CWE-522)
	if err := bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(req.Password)); err != nil {
		recordFailedLogin(req.Email)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Clear failed login attempts on success
	clearFailedLogins(req.Email)

	// Generate JWT token with expiration (CWE-345)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":   fmt.Sprintf("%d", userID),
		"email": req.Email,
		"exp":   time.Now().Add(24 * time.Hour).Unix(),
		"iat":   time.Now().Unix(),
		"nbf":   time.Now().Unix(),
	})

	// Sign with strong secret (CWE-347)
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred",
		})
	}

	// Set secure cookie with HttpOnly, SameSite, and Secure flags (CWE-614, CWE-1275)
	c.Cookie(&fiber.Cookie{
		Name:     "token",
		Value:    tokenString,
		HTTPOnly: true,
		SameSite: "Strict",
		Secure:   true,
		Expires:  time.Now().Add(24 * time.Hour),
		Path:     "/",
	})

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func handleRegister(c *fiber.Ctx) error {
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

	// Password strength check
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Password must be at least 8 characters long",
		})
	}

	// Hash password with bcrypt (CWE-522)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred",
		})
	}

	// Use parameterized query to prevent SQL injection (CWE-89)
	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, string(hashedPassword), req.Name)
	if err != nil {
		// Check if it's a unique constraint violation
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "unique") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}