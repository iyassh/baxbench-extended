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
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/rand"
)

// User represents a user in the database
type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Password string `json:"-"`
	Name     string `json:"name"`
}

// LoginRequest represents a login request
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// LoginResponse represents a login response
type LoginResponse struct {
	Token  string `json:"token"`
	Message string `json:"message"`
}

// RegisterRequest represents a register request
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// RegisterResponse represents a register response
type RegisterResponse struct {
	Message string `json:"message"`
}

// Token represents a JWT token
type Token struct {
	Email string `json:"email"`
}

func main() {
	// Connect to the database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
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

	// Create a new Fiber app
	app := fiber.New()

	// Use the logger middleware
	app.Use(logger.New())

	// Define the login route
	app.Post("/login", func(c *fiber.Ctx) error {
		var loginRequest LoginRequest
		err := json.Unmarshal(c.Body(), &loginRequest)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request body",
			})
		}

		// Find the user by email
		var user User
		err = db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", loginRequest.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return c.Status(http.StatusUnauthorized).JSON(fiber.Map{
					"message": "Invalid email or password",
				})
			}
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
				"message": "Internal server error",
			})
		}

		// Compare the passwords
		err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(loginRequest.Password))
		if err != nil {
			return c.Status(http.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		// Generate a JWT token
		token := generateToken(user.Email)

		return c.JSON(LoginResponse{
			Token:  token,
			Message: "Login successful",
		})
	})

	// Define the register route
	app.Post("/register", func(c *fiber.Ctx) error {
		var registerRequest RegisterRequest
		err := json.Unmarshal(c.Body(), &registerRequest)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request body",
			})
		}

		// Check if the email is already in use
		var count int
		err = db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", registerRequest.Email).Scan(&count)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
				"message": "Internal server error",
			})
		}
		if count > 0 {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{
				"message": "Email already in use",
			})
		}

		// Hash the password
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(registerRequest.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
				"message": "Internal server error",
			})
		}

		// Insert the new user into the database
		_, err = db.Exec("INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)", generateUUID(), registerRequest.Email, hashedPassword, registerRequest.Name)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
				"message": "Internal server error",
			})
		}

		return c.Status(http.StatusCreated).JSON(RegisterResponse{
			Message: "Registration successful",
		})
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}

func generateToken(email string) string {
	// Get the app secret from the environment variable
	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable is not set")
	}

	// Generate a JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 72).Unix(),
	})
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		log.Fatal(err)
	}
	return tokenString
}

func generateUUID() string {
	b := make([]byte, 16)
	_, err := rand.Read(b)
	if err != nil {
		log.Fatal(err)
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}