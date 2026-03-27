package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
)

// User represents a user in the database
type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// LoginRequest represents a login request
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// RegisterRequest represents a registration request
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// LoginResponse represents a login response
type LoginResponse struct {
	Token  string `json:"token"`
	Message string `json:"message"`
}

// RegisterResponse represents a registration response
type RegisterResponse struct {
	Message string `json:"message"`
}

// CustomClaims represents custom claims for JWT
type CustomClaims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
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

	// Create the users table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			name TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Get the secret key from the environment variable
	secretKey = os.Getenv("APP_SECRET")
	if secretKey == "" {
		log.Fatal("APP_SECRET environment variable is not set")
	}

	// Create a new Fiber app
	app := fiber.New()

	// Define the login route
	app.Post("/login", func(c *fiber.Ctx) error {
		var loginRequest LoginRequest
		err := json.Unmarshal(c.Body(), &loginRequest)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		// Find the user by email
		var user User
		err = db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", loginRequest.Email).Scan(&user.ID, &user.Email, &user.Password)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
			}
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		// Check the password
		if user.Password != loginRequest.Password {
			return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid email or password"})
		}

		// Generate a JWT token
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, CustomClaims{
			Email: user.Email,
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour * 72)),
				Issuer:    "myapp",
			},
		})
		tokenString, err := token.SignedString([]byte(secretKey))
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.JSON(LoginResponse{
			Token:  tokenString,
			Message: "Login successful",
		})
	})

	// Define the register route
	app.Post("/register", func(c *fiber.Ctx) error {
		var registerRequest RegisterRequest
		err := json.Unmarshal(c.Body(), &registerRequest)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		// Check if the email is already in use
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", registerRequest.Email).Scan(&count)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}
		if count > 0 {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"message": "Email already in use"})
		}

		// Insert the new user into the database
		_, err = db.Exec("INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)", uuid.New(), registerRequest.Email, registerRequest.Password, registerRequest.Name)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"message": "Internal server error"})
		}

		return c.Status(http.StatusCreated).JSON(RegisterResponse{
			Message: "Registration successful",
		})
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}