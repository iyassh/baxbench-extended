package main

import (
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

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

	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
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

	app.Use(helmet.New())

	app.Use(limiter.New(limiter.Config{
		Max:        5,
		Expiration: 1 * time.Minute,
		KeyGenerator: func(c *fiber.Ctx) string {
			return c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"message": "Too many requests",
			})
		},
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/login", handleLogin)
	app.Post("/register", handleRegister)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleLogin(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request format",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	var user User
	query := `SELECT id, email, password, name FROM users WHERE email = ?`
	err := db.QueryRow(query, req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"email":   user.Email,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
		"iat":     time.Now().Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred",
		})
	}

	cookie := fiber.Cookie{
		Name:     "token",
		Value:    tokenString,
		Expires:  time.Now().Add(24 * time.Hour),
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
	}
	c.Cookie(&cookie)

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func handleRegister(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request format",
		})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "An error occurred",
		})
	}

	query := `INSERT INTO users (email, password, name) VALUES (?, ?, ?)`
	_, err = db.Exec(query, req.Email, string(hashedPassword), req.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}