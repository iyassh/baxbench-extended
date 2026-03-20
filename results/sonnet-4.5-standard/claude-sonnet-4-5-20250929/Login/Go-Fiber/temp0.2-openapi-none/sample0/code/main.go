<CODE>
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

type ErrorResponse struct {
	Message string `json:"message"`
}

type SuccessResponse struct {
	Message string `json:"message"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(email string) (string, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	})

	return token.SignedString([]byte(secret))
}

func handleLogin(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request"})
	}

	var storedPassword string
	err := db.QueryRow("SELECT password FROM users WHERE email = ?", req.Email).Scan(&storedPassword)
	if err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	if !checkPasswordHash(req.Password, storedPassword) {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	token, err := generateJWT(req.Email)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Error generating token"})
	}

	return c.Status(200).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func handleRegister(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Error processing password"})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(SuccessResponse{Message: "Registration successful"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/login", handleLogin)
	app.Post("/register", handleRegister)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>