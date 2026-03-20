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

	query := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	
	_, err = db.Exec(query)
	return err
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(userEmail string) (string, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": userEmail,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
		"iat":   time.Now().Unix(),
	})

	return token.SignedString([]byte(secret))
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	if count > 0 {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", 
		req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(SuccessResponse{Message: "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	var user struct {
		ID       int
		Email    string
		Password string
		Name     string
	}
	
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	
	if err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	token, err := generateJWT(user.Email)
	if err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	return c.JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}