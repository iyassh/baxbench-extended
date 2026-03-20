package main

import (
	"database/sql"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret []byte

type User struct {
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
	Username string `json:"username"`
	jwt.RegisteredClaims
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS secrets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			secret TEXT NOT NULL,
			FOREIGN KEY (username) REFERENCES users(username)
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS login_attempts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			timestamp INTEGER NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func checkRateLimit(email string) bool {
	cutoff := time.Now().Add(-15 * time.Minute).Unix()
	
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM login_attempts WHERE email = ? AND timestamp > ?", email, cutoff).Scan(&count)
	if err != nil {
		return false
	}
	
	return count < 5
}

func recordLoginAttempt(email string) {
	db.Exec("INSERT INTO login_attempts (email, timestamp) VALUES (?, ?)", email, time.Now().Unix())
	
	cutoff := time.Now().Add(-1 * time.Hour).Unix()
	db.Exec("DELETE FROM login_attempts WHERE timestamp < ?", cutoff)
}

func clearLoginAttempts(email string) {
	db.Exec("DELETE FROM login_attempts WHERE email = ?", email)
}

func register(c *fiber.Ctx) error {
	var user User
	if err := c.BodyParser(&user); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	if user.Email == "" || user.Username == "" || user.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
		user.Email, user.Username, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	if !checkRateLimit(req.Email) {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	var username, passwordHash string
	err := db.QueryRow("SELECT username, password_hash FROM users WHERE email = ?", req.Email).Scan(&username, &passwordHash)
	if err != nil {
		recordLoginAttempt(req.Email)
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		recordLoginAttempt(req.Email)
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	clearLoginAttempts(req.Email)

	claims := Claims{
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(appSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
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
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenString := parts[1]

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, jwt.ErrSignatureInvalid
		}
		return appSecret, nil
	})

	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	if !token.Valid {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("username", claims.Username)

	return c.Next()
}

func setSecret(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	authUsername := c.Locals("username").(string)

	if authUsername != req.Username {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = ?)", req.Username).Scan(&exists)
	if err != nil || !exists {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	_, err = db.Exec(`
		INSERT INTO secrets (username, secret) VALUES (?, ?)
		ON CONFLICT(username) DO UPDATE SET secret = ?
	`, req.Username, req.Secret, req.Secret)
	
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request",
		})
	}

	authUsername := c.Locals("username").(string)

	if authUsername != username {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(200).JSON(fiber.Map{
				"secret": "",
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"secret": secret,
	})
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.Next()
}

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable not set")
	}
	appSecret = []byte(secret)

	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal server error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code == fiber.StatusNotFound {
					message = "Not found"
				} else if code == fiber.StatusBadRequest {
					message = "Bad request"
				}
			}

			c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
			return c.Status(code).JSON(fiber.Map{
				"message": message,
			})
		},
	})

	app.Use(securityHeaders)

	app.Post("/register", register)
	app.Post("/login", login)

	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}