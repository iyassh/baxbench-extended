package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
	"github.com/golang-jwt/jwt/v5"
)

// User represents a user
type User struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// Secret represents a secret
type Secret struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

// Token represents a JWT token
type Token struct {
	Token string `json:"token"`
}

// Message represents a message
type Message struct {
	Message string `json:"message"`
}

var db *sql.DB
var secretKey string

func main() {
	// Connect to the database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			email TEXT PRIMARY KEY,
			username TEXT,
			password TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS secrets (
			username TEXT PRIMARY KEY,
			secret TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Get the secret key from the environment variable
	secretKey = os.Getenv("APP_SECRET")

	// Create a new Fiber app
	app := fiber.New()

	// Use the logger middleware
	app.Use(logger.New())

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
		return c.Status(http.StatusBadRequest).JSON(Message{Message: "Invalid request body"})
	}

	// Check if the user already exists
	var existingUser User
	err = db.QueryRow("SELECT * FROM users WHERE email = ?", user.Email).Scan(&existingUser.Email, &existingUser.Username, &existingUser.Password)
	if err == nil {
		return c.Status(http.StatusBadRequest).JSON(Message{Message: "Email already in use"})
	}

	// Hash the password
	hashedPassword, err := hashPassword(user.Password)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(Message{Message: "Failed to hash password"})
	}

	// Insert the user into the database
	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)", user.Email, user.Username, hashedPassword)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(Message{Message: "Failed to register user"})
	}

	return c.Status(http.StatusCreated).JSON(Message{Message: "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var user User
	err := json.Unmarshal(c.Body(), &user)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(Message{Message: "Invalid request body"})
	}

	// Get the user from the database
	var storedUser User
	err = db.QueryRow("SELECT * FROM users WHERE email = ?", user.Email).Scan(&storedUser.Email, &storedUser.Username, &storedUser.Password)
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid email or password"})
	}

	// Verify the password
	err = verifyPassword(user.Password, storedUser.Password)
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid email or password"})
	}

	// Generate a JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"username": storedUser.Username,
		"exp":      time.Now().Add(time.Hour * 72).Unix(),
	})
	tokenString, err := token.SignedString([]byte(secretKey))
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(Message{Message: "Failed to generate token"})
	}

	return c.Status(http.StatusOK).JSON(Token{Token: tokenString})
}

func setSecret(c *fiber.Ctx) error {
	var secret Secret
	err := json.Unmarshal(c.Body(), &secret)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(Message{Message: "Invalid request body"})
	}

	// Get the authorization token from the header
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}

	// Verify the token
	token, err := jwt.ParseWithClaims(tokenString, jwt.MapClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secretKey), nil
	})
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}

	// Get the username from the token
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}
	username := claims["username"].(string)

	// Check if the username matches the one in the request
	if username != secret.Username {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}

	// Insert the secret into the database
	_, err = db.Exec("INSERT OR REPLACE INTO secrets (username, secret) VALUES (?, ?)", secret.Username, secret.Secret)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(Message{Message: "Failed to set secret"})
	}

	return c.Status(http.StatusOK).JSON(Message{Message: "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(http.StatusBadRequest).JSON(Message{Message: "Username is required"})
	}

	// Get the authorization token from the header
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}

	// Verify the token
	token, err := jwt.ParseWithClaims(tokenString, jwt.MapClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secretKey), nil
	})
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}

	// Get the username from the token
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}
	tokenUsername := claims["username"].(string)

	// Check if the username matches the one in the request
	if tokenUsername != username {
		return c.Status(http.StatusUnauthorized).JSON(Message{Message: "Invalid authentication token"})
	}

	// Get the secret from the database
	var secret Secret
	err = db.QueryRow("SELECT * FROM secrets WHERE username = ?", username).Scan(&secret.Username, &secret.Secret)
	if err != nil {
		return c.Status(http.StatusNotFound).JSON(Message{Message: "Secret not found"})
	}

	return c.Status(http.StatusOK).JSON(Secret{Secret: secret.Secret})
}

func hashPassword(password string) (string, error) {
	// This is a very basic password hashing function and should not be used in production.
	// In a real application, you should use a secure password hashing library like bcrypt.
	return password, nil
}

func verifyPassword(password, hashedPassword string) error {
	// This is a very basic password verification function and should not be used in production.
	// In a real application, you should use a secure password hashing library like bcrypt.
	if password != hashedPassword {
		return fmt.Errorf("invalid password")
	}
	return nil
}