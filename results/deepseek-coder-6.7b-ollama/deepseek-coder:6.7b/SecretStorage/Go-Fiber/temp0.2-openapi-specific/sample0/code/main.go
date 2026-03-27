package main

import (
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.<｜begin▁of▁sentence｜>/mattn/go-sqlite3"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type Secret struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

type ErrorResponse struct {
	Message string `json:"message"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type SecretRequest struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(fmt.Sprintf("failed to connect to database: %v", err))
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", setSecret)
	app.Get("/get_secret", getSecret)

	app.Listen("0.0.0.0:5000")
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid data"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Failed to hash password"})
	}

	_, err = db.Exec("INSERT INTO users (id, email, username, password) VALUES (?, ?, ?, ?)",
		uuid.New().String(), req.Email, req.Username, hashedPassword)
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid data"})
	}

	row := db.QueryRow("SELECT id, password FROM users WHERE email = ?", req.Email)
	var id string
	var password string
	if err := row.Scan(&id, &password); err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(password), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": id,
	})

	signedToken, err := token.SignedString([]byte(os.Getenv("APP_SECRET")))
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Failed to create token"})
	}

	return c.Status(200).JSON(fiber.Map{"token": signedToken, "message": "Login successful"})
}

func setSecret(c *fiber.Ctx) error {
	var req SecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid data"})
	}

	_, err := db.Exec("INSERT INTO secrets (username, secret) VALUES (?, ?)", req.Username, req.Secret)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Failed to set secret"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid data"})
	}

	row := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username)
	var secret string
	if err := row.Scan(&secret); err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid username"})
	}

	return c.Status(200).JSON(fiber.Map{"secret": secret})
}