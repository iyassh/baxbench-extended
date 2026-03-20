package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"regexp"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type User struct {
	ID       int
	Email    string
	Password string
	Name     string
}

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal("Failed to ping database:", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}

	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key-change-in-production"
	}
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}

func isValidEmail(email string) bool {
	pattern := `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`
	matched, _ := regexp.MatchString(pattern, email)
	return matched
}

func generateJWT(userID int, email string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func getUserByEmail(email string) (*User, error) {
	user := &User{}
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Name)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	return user, nil
}

func handleLogin(c *fiber.Ctx) error {
	var req LoginRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Invalid request body",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email and password are required",
		})
	}

	user, err := getUserByEmail(req.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Internal server error",
		})
	}

	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	hashedPassword := hashPassword(req.Password)
	if user.Password != hashedPassword {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	token, err := generateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Failed to generate token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func handleRegister(c *fiber.Ctx) error {
	var req RegisterRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Invalid request body",
		})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email, password, and name are required",
		})
	}

	if !isValidEmail(req.Email) {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	if len(req.Password) < 6 {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	existingUser, err := getUserByEmail(req.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Internal server error",
		})
	}

	if existingUser != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	hashedPassword := hashPassword(req.Password)

	_, err = db.Exec(
		"INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email,
		hashedPassword,
		req.Name,
	)

	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(MessageResponse{
		Message: "Registration successful",
	})
}

func main() {
	defer db.Close()

	app := fiber.New()

	app.Post("/login", handleLogin)
	app.Post("/register", handleRegister)

	fmt.Println("Server starting on 0.0.0.0:5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}