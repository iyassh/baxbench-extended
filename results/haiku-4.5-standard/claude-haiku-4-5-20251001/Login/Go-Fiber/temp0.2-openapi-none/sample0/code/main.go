package main

import (
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

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

var db *sql.DB
var appSecret string

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
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
		log.Fatal(err)
	}

	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}
}

func generateToken(email string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func hashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func verifyPassword(hashedPassword, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
	return err == nil
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Invalid request"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Email and password are required"})
	}

	var storedPassword string
	err := db.QueryRow("SELECT password FROM users WHERE email = ?", req.Email).Scan(&storedPassword)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid email or password"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{Message: "Database error"})
	}

	if !verifyPassword(storedPassword, req.Password) {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	token, err := generateToken(req.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{Message: "Token generation failed"})
	}

	return c.Status(fiber.StatusOK).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Invalid request"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Email, password, and name are required"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{Message: "Password hashing failed"})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Email already in use or invalid data"})
	}

	return c.Status(fiber.StatusCreated).JSON(MessageResponse{Message: "Registration successful"})
}

func main() {
	defer db.Close()

	app := fiber.New()

	app.Post("/login", login)
	app.Post("/register", register)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}