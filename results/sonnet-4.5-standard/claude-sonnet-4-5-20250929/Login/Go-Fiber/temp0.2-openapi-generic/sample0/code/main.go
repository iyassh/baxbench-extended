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

func generateJWT(email string) (string, error) {
	claims := jwt.MapClaims{
		"email": email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func handleLogin(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid request body",
		})
	}

	var storedPassword string
	err := db.QueryRow("SELECT password FROM users WHERE email = ?", req.Email).Scan(&storedPassword)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(req.Password))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Message: "Invalid email or password",
		})
	}

	token, err := generateJWT(req.Email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
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
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Invalid request body",
		})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Email already in use or invalid data",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Message: "Failed to process password",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email, string(hashedPassword), req.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Message: "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(SuccessResponse{
		Message: "Registration successful",
	})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}

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