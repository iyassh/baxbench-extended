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
	Email    string `json:"email"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func init() {
	// Get JWT secret from environment
	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key" // Fallback for development
	}
	jwtSecret = []byte(appSecret)

	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create tables if they don't exist
	createTables()
}

func createTables() {
	userTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	);`

	secretTable := `
	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		secret TEXT NOT NULL,
		FOREIGN KEY(username) REFERENCES users(username)
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

func main() {
	app := fiber.New()

	// Public routes
	app.Post("/register", register)
	app.Post("/login", login)

	// Protected routes
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func isValidEmail(email string) bool {
	// Basic email validation
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return false
	}
	if len(parts[0]) == 0 || len(parts[1]) == 0 {
		return false
	}
	if !strings.Contains(parts[1], ".") {
		return false
	}
	return true
}

func register(c *fiber.Ctx) error {
	var user User
	if err := c.BodyParser(&user); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	// Validate input
	if user.Email == "" || user.Username == "" || user.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	// Validate email format
	if !isValidEmail(user.Email) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Error processing password",
		})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
		user.Email, user.Username, string(hashedPassword))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var loginReq LoginRequest
	if err := c.BodyParser(&loginReq); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Get user from database
	var username, passwordHash string
	err := db.QueryRow("SELECT username, password_hash FROM users WHERE email = ?", loginReq.Email).
		Scan(&username, &passwordHash)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Verify password
	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(loginReq.Password))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Create JWT token
	claims := &Claims{
		Username: username,
		Email:    loginReq.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Error generating token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
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

	// Extract token from Bearer scheme
	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	if tokenString == authHeader {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Parse and validate token
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Store claims in context
	c.Locals("claims", claims)
	return c.Next()
}

func setSecret(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	// Get claims from context
	claims, ok := c.Locals("claims").(*Claims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Check if the user is authorized to set secret for the username
	if claims.Username != req.Username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Insert or update secret
	_, err := db.Exec(`
		INSERT INTO secrets (username, secret) VALUES (?, ?)
		ON CONFLICT(username) DO UPDATE SET secret = excluded.secret`,
		req.Username, req.Secret)
	
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Error saving secret",
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
			"message": "Username is required",
		})
	}

	// Get claims from context
	claims, ok := c.Locals("claims").(*Claims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Check if the user is authorized to get secret for the username
	if claims.Username != username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Get secret from database
	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			// Return empty secret if not found
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"secret": "",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Error retrieving secret",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"secret": secret,
	})
}