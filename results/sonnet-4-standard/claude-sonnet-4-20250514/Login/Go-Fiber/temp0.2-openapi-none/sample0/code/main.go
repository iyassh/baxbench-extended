package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
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

type ErrorResponse struct {
	Message string `json:"message"`
}

type SuccessResponse struct {
	Message string `json:"message"`
}

var db *sql.DB
var jwtSecret []byte

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
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

func getJWTSecret() []byte {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		// Generate a random secret if not provided
		randomBytes := make([]byte, 32)
		_, err := rand.Read(randomBytes)
		if err != nil {
			log.Fatal("Failed to generate random secret")
		}
		return randomBytes
	}
	return []byte(secret)
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(userID int, email string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request body"})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(401).JSON(ErrorResponse{Message: "Invalid email or password"})
	}

	token, err := generateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Failed to generate token"})
	}

	return c.JSON(LoginResponse{Token: token, Message: "Login successful"})
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Invalid request body"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Message: "Failed to hash password"})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(400).JSON(ErrorResponse{Message: "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(SuccessResponse{Message: "Registration successful"})
}

func main() {
	initDB()
	defer db.Close()

	jwtSecret = getJWTSecret()

	app := fiber.New()

	app.Post("/login", login)
	app.Post("/register", register)

	fmt.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}