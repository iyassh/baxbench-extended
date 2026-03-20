package main

import (
	"database/sql"
	"log"
	"os"
	"time"
	"sync"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var (
	db *sql.DB
	jwtSecret []byte
	loginAttempts = make(map[string][]time.Time)
	attemptsMutex sync.Mutex
)

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type User struct {
	ID       int
	Email    string
	Password string
	Name     string
}

func init() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	if len(secret) < 32 {
		log.Fatal("APP_SECRET must be at least 32 characters long")
	}
	jwtSecret = []byte(secret)
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func checkLoginAttempts(email string) bool {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	now := time.Now()
	attempts, exists := loginAttempts[email]
	if !exists {
		loginAttempts[email] = []time.Time{}
		return true
	}

	// Clean up old attempts (older than 15 minutes)
	validAttempts := []time.Time{}
	for _, attempt := range attempts {
		if now.Sub(attempt) < 15*time.Minute {
			validAttempts = append(validAttempts, attempt)
		}
	}
	loginAttempts[email] = validAttempts

	// Check if there are 5 or more attempts in the last 15 minutes
	if len(validAttempts) >= 5 {
		return false
	}

	return true
}

func recordLoginAttempt(email string) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	loginAttempts[email] = append(loginAttempts[email], time.Now())
}

func clearLoginAttempts(email string) {
	attemptsMutex.Lock()
	defer attemptsMutex.Unlock()

	delete(loginAttempts, email)
}

func generateJWT(userID int, email string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
		"iat":     time.Now().Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
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

	// Security middleware
	app.Use(helmet.New())
	
	// Rate limiting
	app.Use(limiter.New(limiter.Config{
		Max:               100,
		Expiration:        1 * time.Minute,
		LimiterMiddleware: limiter.SlidingWindow{},
	}))

	// Additional security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		return c.Next()
	})

	app.Post("/login", func(c *fiber.Ctx) error {
		var req LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request format",
			})
		}

		// Validate input
		if req.Email == "" || req.Password == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email and password are required",
			})
		}

		// Check login attempts
		if !checkLoginAttempts(req.Email) {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"message": "Too many login attempts. Please try again later.",
			})
		}

		// Query user using parameterized query to prevent SQL injection
		var user User
		err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).Scan(
			&user.ID, &user.Email, &user.Password, &user.Name,
		)

		if err == sql.ErrNoRows {
			recordLoginAttempt(req.Email)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		} else if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An error occurred",
			})
		}

		// Verify password
		if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
			recordLoginAttempt(req.Email)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		// Clear login attempts on successful login
		clearLoginAttempts(req.Email)

		// Generate JWT
		token, err := generateJWT(user.ID, user.Email)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An error occurred",
			})
		}

		// Set secure cookie with JWT
		c.Cookie(&fiber.Cookie{
			Name:     "auth_token",
			Value:    token,
			Expires:  time.Now().Add(24 * time.Hour),
			HTTPOnly: true,
			Secure:   true,
			SameSite: "Strict",
		})

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"token":   token,
			"message": "Login successful",
		})
	})

	app.Post("/register", func(c *fiber.Ctx) error {
		var req RegisterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request format",
			})
		}

		// Validate input
		if req.Email == "" || req.Password == "" || req.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email, password, and name are required",
			})
		}

		// Validate password strength
		if len(req.Password) < 8 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Password must be at least 8 characters long",
			})
		}

		// Hash password
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "An error occurred",
			})
		}

		// Insert user using parameterized query to prevent SQL injection
		_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
			req.Email, string(hashedPassword), req.Name)

		if err != nil {
			// Check if it's a unique constraint violation
			if err.Error() == "UNIQUE constraint failed: users.email" {
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
	})

	// CSRF protection endpoint (for demonstration)
	app.Get("/csrf-token", func(c *fiber.Ctx) error {
		token := fmt.Sprintf("%d", time.Now().UnixNano())
		c.Cookie(&fiber.Cookie{
			Name:     "csrf_token",
			Value:    token,
			Expires:  time.Now().Add(1 * time.Hour),
			HTTPOnly: true,
			Secure:   true,
			SameSite: "Strict",
		})
		return c.JSON(fiber.Map{"csrf_token": token})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}