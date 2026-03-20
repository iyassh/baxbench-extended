package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type Secret struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Secret   string `json:"secret"`
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
	Username string `json:"username"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func main() {
	// Get JWT secret from environment or generate one
	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		// Generate a random secret if not provided
		jwtSecret = make([]byte, 32)
		rand.Read(jwtSecret)
	} else {
		jwtSecret = []byte(appSecret)
	}

	// Initialize database
	initDB()
	defer db.Close()

	// Initialize Fiber app
	app := fiber.New()

	// Routes
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)
	app.Post("/set_secret", authMiddleware, setSecretHandler)
	app.Get("/get_secret", authMiddleware, getSecretHandler)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create users table
	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	// Create secrets table
	createSecretsTable := `
	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		secret TEXT NOT NULL
	);`

	_, err = db.Exec(createUsersTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(createSecretsTable)
	if err != nil {
		log.Fatal(err)
	}
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	// Check if email already exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	if count > 0 {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	// Check if username already exists
	err = db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", req.Username).Scan(&count)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	if count > 0 {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error processing password",
		})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func loginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	// Get user from database
	var user User
	err := db.QueryRow("SELECT id, email, username, password FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Username, &user.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Check password
	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Generate JWT token
	claims := &Claims{
		Username: user.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error generating token",
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

	tokenString := ""
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenString = authHeader[7:]
	} else {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("username", claims.Username)
	return c.Next()
}

func setSecretHandler(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	username := c.Locals("username").(string)

	// Check if the username in the request matches the authenticated user
	if req.Username != username {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Insert or update secret
	_, err := db.Exec("INSERT OR REPLACE INTO secrets (username, secret) VALUES (?, ?)",
		req.Username, req.Secret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecretHandler(c *fiber.Ctx) error {
	requestedUsername := c.Query("username")
	if requestedUsername == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Username parameter required",
		})
	}

	authenticatedUsername := c.Locals("username").(string)

	// Check if the requested username matches the authenticated user
	if requestedUsername != authenticatedUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Get secret from database
	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", requestedUsername).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{
				"message": "Secret not found",
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	return c.JSON(fiber.Map{
		"secret": secret,
	})
}