package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	_ "github.com/mattn/go-sqlite3"
)

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
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

var db *sql.DB
var appSecret string

func main() {
	// Get app secret from environment
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}

	// Initialize database
	initDB()

	// Create Fiber app
	app := fiber.New()

	// Routes
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)
	app.Post("/set_secret", authMiddleware, setSecretHandler)
	app.Get("/get_secret", authMiddleware, getSecretHandler)

	// Start server
	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create users table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create secrets table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS secrets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			secret_encrypted TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Validate input
	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email, username and password are required",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Insert user into database
	_, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
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
			"message": "Invalid request body",
		})
	}

	// Get user from database
	var user User
	var hashedPassword string
	err := db.QueryRow("SELECT id, email, username, password_hash FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Username, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Verify password
	err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	// Create JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
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

	// Extract token from "Bearer <token>"
	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenString := parts[1]

	// Parse and validate token
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Extract claims
	if claims, ok := token.Claims.(jwt.MapClaims); ok {
		c.Locals("user_id", claims["user_id"])
		c.Locals("username", claims["username"])
	} else {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.Next()
}

func setSecretHandler(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Get username from token
	tokenUsername := c.Locals("username").(string)

	// Check if the username in request matches the token
	if req.Username != tokenUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Encrypt secret
	encryptedSecret, err := encrypt(req.Secret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Store or update secret
	_, err = db.Exec("INSERT OR REPLACE INTO secrets (username, secret_encrypted) VALUES (?, ?)",
		req.Username, encryptedSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecretHandler(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Username parameter is required",
		})
	}

	// Get username from token
	tokenUsername := c.Locals("username").(string)

	// Check if the username in request matches the token
	if username != tokenUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	// Get encrypted secret from database
	var encryptedSecret string
	err := db.QueryRow("SELECT secret_encrypted FROM secrets WHERE username = ?", username).
		Scan(&encryptedSecret)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.JSON(fiber.Map{
				"secret": "",
			})
		}
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	// Decrypt secret
	decryptedSecret, err := decrypt(encryptedSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.JSON(fiber.Map{
		"secret": decryptedSecret,
	})
}

func encrypt(plaintext string) (string, error) {
	key := []byte(appSecret)
	if len(key) < 32 {
		// Pad key to 32 bytes
		key = append(key, make([]byte, 32-len(key))...)
	} else if len(key) > 32 {
		// Truncate key to 32 bytes
		key = key[:32]
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func decrypt(ciphertext string) (string, error) {
	key := []byte(appSecret)
	if len(key) < 32 {
		// Pad key to 32 bytes
		key = append(key, make([]byte, 32-len(key))...)
	} else if len(key) > 32 {
		// Truncate key to 32 bytes
		key = key[:32]
	}

	data, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, encryptedData := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, encryptedData, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}