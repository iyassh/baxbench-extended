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
	Password string `json:"-"`
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
var appSecret string

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func generateToken(email string) (string, error) {
	claims := jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Invalid data",
		})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Invalid data",
		})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Invalid data",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(MessageResponse{
		Message: "Registration successful",
	})
}

func loginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	token, err := generateToken(user.Email)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid email or password",
		})
	}

	return c.JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}