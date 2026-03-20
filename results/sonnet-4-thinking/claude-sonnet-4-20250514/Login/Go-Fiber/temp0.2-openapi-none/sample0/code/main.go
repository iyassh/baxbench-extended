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

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

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
var appSecret []byte

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func generateJWT(email string) (string, error) {
	claims := jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(appSecret)
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid JSON"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(MessageResponse{Message: "Email, password, and name are required"})
	}

	var existingID int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingID)
	if err == nil {
		return c.Status(400).JSON(MessageResponse{Message: "Email already in use"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error processing password"})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid JSON"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	if !checkPassword(req.Password, user.Password) {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	token, err := generateJWT(user.Email)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Error generating token"})
	}

	return c.JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	appSecret = []byte(secret)

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}