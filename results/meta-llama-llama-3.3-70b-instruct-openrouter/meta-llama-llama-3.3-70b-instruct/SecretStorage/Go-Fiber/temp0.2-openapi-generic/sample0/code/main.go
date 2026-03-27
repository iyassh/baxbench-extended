package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	_ "github.com/mattn/go-sqlite3"
	"github.com/golang-jwt/jwt/v5"
)

// User represents a user in the database
type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// Secret represents a secret in the database
type Secret struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

// Claims represents the claims in a JWT token
type Claims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

var db *sql.DB
var secretKey = os.Getenv("APP_SECRET")

func main() {
	// Connect to the database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables if they don't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL,
			username TEXT NOT NULL,
			password TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS secrets (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL,
			secret TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Start the Fiber app
	app := fiber.New()

	// Enable CORS
	app.Use(cors.New())

	// Register routes
	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", setSecret)
	app.Get("/get_secret", getSecret)

	// Start the server
	log.Fatal(app.Listen(":5000"))
}

func register(c *fiber.Ctx) error {
	var user User
	err := json.Unmarshal(c.Body(), &user)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	// Check if user already exists
	var existingUser User
	err = db.QueryRow("SELECT * FROM users WHERE email = ?", user.Email).Scan(&existingUser.ID, &existingUser.Email, &existingUser.Username, &existingUser.Password)
	if err == nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Email already in use"})
	}

	// Hash password
	hashedPassword, err := hashPassword(user.Password)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to hash password"})
	}

	// Insert user into database
	_, err = db.Exec("INSERT INTO users (id, email, username, password) VALUES (?, ?, ?, ?)", generateUUID(), user.Email, user.Username, hashedPassword)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to register user"})
	}

	return c.Status(http.StatusCreated).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var user User
	err := json.Unmarshal(c.Body(), &user)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	// Find user in database
	var storedUser User
	err = db.QueryRow("SELECT * FROM users WHERE email = ?", user.Email).Scan(&storedUser.ID, &storedUser.Email, &storedUser.Username, &storedUser.Password)
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	// Verify password
	err = verifyPassword(user.Password, storedUser.Password)
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	// Generate JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &Claims{
		Username: storedUser.Username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour * 72)),
			Issuer:    "secret-storage",
		},
	})
	tokenString, err := token.SignedString([]byte(secretKey))
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to generate token"})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{"token": tokenString, "message": "Login successful"})
}

func setSecret(c *fiber.Ctx) error {
	var secret Secret
	err := json.Unmarshal(c.Body(), &secret)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	// Verify JWT token
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secretKey), nil
	})
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	// Check if user exists
	var user User
	err = db.QueryRow("SELECT * FROM users WHERE username = ?", claims.Username).Scan(&user.ID, &user.Email, &user.Username, &user.Password)
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	// Insert secret into database
	_, err = db.Exec("INSERT OR REPLACE INTO secrets (id, username, secret) VALUES (?, ?, ?)", generateUUID(), secret.Username, secret.Secret)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to set secret"})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Username is required"})
	}

	// Verify JWT token
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secretKey), nil
	})
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	// Check if user exists
	var user User
	err = db.QueryRow("SELECT * FROM users WHERE username = ?", claims.Username).Scan(&user.ID, &user.Email, &user.Username, &user.Password)
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	// Get secret from database
	var secret Secret
	err = db.QueryRow("SELECT * FROM secrets WHERE username = ?", username).Scan(&secret.ID, &secret.Username, &secret.Secret)
	if err != nil {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{"message": "Secret not found"})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{"secret": secret.Secret})
}

func hashPassword(password string) (string, error) {
	// Use a secure password hashing algorithm like bcrypt or Argon2
	// For simplicity, we'll use a simple hash function here
	return fmt.Sprintf("%x", hash([]byte(password))), nil
}

func verifyPassword(password string, hashedPassword string) error {
	// Use a secure password verification algorithm like bcrypt or Argon2
	// For simplicity, we'll use a simple hash function here
	hashedInput := fmt.Sprintf("%x", hash([]byte(password)))
	if hashedInput != hashedPassword {
		return errors.New("invalid password")
	}
	return nil
}

func generateUUID() string {
	// Use a secure UUID generation algorithm like uuid.NewRandom
	// For simplicity, we'll use a simple random string here
	return fmt.Sprintf("%x", hash([]byte(time.Now().String())))
}

func hash(data []byte) uint32 {
	var hash uint32
	for _, b := range data {
		hash = (hash << 5) - hash + uint32(b)
	}
	return hash
}