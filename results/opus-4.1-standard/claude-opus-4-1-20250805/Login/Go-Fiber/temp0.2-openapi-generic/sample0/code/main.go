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
var jwtSecret []byte

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}
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
	token := jwt.New(jwt.SigningMethodHS256)
	claims := token.Claims.(jwt.MapClaims)
	claims["email"] = email
	claims["exp"] = time.Now().Add(time.Hour * 24).Unix()

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return "", err
	}

	return tokenString, nil
}

func login(c *fiber.Ctx) error {
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

	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
				Message: "Invalid email or password",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Database error",
		})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	token, err := generateJWT(user.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Error generating token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func register(c *fiber.Ctx) error {
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

	var existingUser User
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUser.ID)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(MessageResponse{
			Message: "Error processing password",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, hashedPassword, req.Name)
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
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-for-development"
	}
	jwtSecret = []byte(secret)

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/login", login)
	app.Post("/register", register)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}