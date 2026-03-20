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

var db *sql.DB

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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTableQuery)
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

func generateJWT(email string) (string, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}

	claims := jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func registerHandler(c *fiber.Ctx) error {
	req := new(RegisterRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid data",
		})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid data",
		})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid data",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(SuccessResponse{
		Message: "Registration successful",
	})
}

func loginHandler(c *fiber.Ctx) error {
	req := new(LoginRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?",
		req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	token, err := generateJWT(user.Email)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	return c.Status(fiber.StatusOK).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}