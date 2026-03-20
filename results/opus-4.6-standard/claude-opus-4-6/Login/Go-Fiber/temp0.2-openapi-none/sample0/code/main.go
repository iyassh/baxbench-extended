package main

import (
	"database/sql"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB

func getSecret() string {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	return secret
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		panic(err)
	}
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

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/login", func(c *fiber.Ctx) error {
		var req LoginRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request body",
			})
		}

		var storedPassword string
		var userID int
		err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", req.Email).Scan(&userID, &storedPassword)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		err = bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(req.Password))
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"message": "Invalid email or password",
			})
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": userID,
			"email":   req.Email,
			"exp":     time.Now().Add(24 * time.Hour).Unix(),
		})

		tokenString, err := token.SignedString([]byte(getSecret()))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "Could not generate token",
			})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"token":   tokenString,
			"message": "Login successful",
		})
	})

	app.Post("/register", func(c *fiber.Ctx) error {
		var req RegisterRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Invalid request body",
			})
		}

		if req.Email == "" || req.Password == "" || req.Name == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"message": "Could not hash password",
			})
		}

		_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", req.Email, string(hashedPassword), req.Name)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"message": "Email already in use or invalid data",
			})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{
			"message": "Registration successful",
		})
	})

	app.Listen("0.0.0.0:5000")
}