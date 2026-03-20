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

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type SetSecretRequest struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

type Claims struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	jwt.RegisteredClaims
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS secrets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			secret TEXT NOT NULL,
			FOREIGN KEY (username) REFERENCES users(username)
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email, username and password are required",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error hashing password",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	var user User
	var passwordHash string
	err := db.QueryRow("SELECT id, email, username, password_hash FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Username, &passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	claims := Claims{
		Username: user.Username,
		Email:    user.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error generating token",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenString := authHeader
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenString = authHeader[7:]
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	c.Locals("username", claims.Username)
	c.Locals("email", claims.Email)

	return c.Next()
}

func setSecret(c *fiber.Ctx) error {
	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"message": "Invalid data",
		})
	}

	authenticatedUsername := c.Locals("username").(string)

	if req.Username != authenticatedUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var existingSecret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", req.Username).Scan(&existingSecret)

	if err == sql.ErrNoRows {
		_, err = db.Exec("INSERT INTO secrets (username, secret) VALUES (?, ?)", req.Username, req.Secret)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"message": "Error saving secret",
			})
		}
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error checking secret",
		})
	} else {
		_, err = db.Exec("UPDATE secrets SET secret = ? WHERE username = ?", req.Secret, req.Username)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"message": "Error updating secret",
			})
		}
	}

	return c.Status(200).JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecret(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{
			"message": "Username is required",
		})
	}

	authenticatedUsername := c.Locals("username").(string)

	if username != authenticatedUsername {
		return c.Status(401).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{
			"message": "Secret not found",
		})
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"message": "Error retrieving secret",
		})
	}

	return c.Status(200).JSON(fiber.Map{
		"secret": secret,
	})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key-change-me"
	}

	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", authMiddleware, setSecret)
	app.Get("/get_secret", authMiddleware, getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}