package main

import (
	"database/sql"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			username TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS secrets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			secret TEXT NOT NULL
		);
	`)
	if err != nil {
		panic(err)
	}
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
	app.Post("/set_secret", authMiddleware, setSecretHandler)
	app.Get("/get_secret", authMiddleware, getSecretHandler)

	app.Listen("0.0.0.0:5000")
}

func registerHandler(c *fiber.Ctx) error {
	type RegisterRequest struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)", req.Email, req.Username, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
	type LoginRequest struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	var storedPassword string
	var username string
	err := db.QueryRow("SELECT username, password FROM users WHERE email = ?", req.Email).Scan(&username, &storedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"username": username,
		"email":    req.Email,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	tokenString := parts[1]

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	username, ok := claims["username"].(string)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	c.Locals("username", username)
	return c.Next()
}

func setSecretHandler(c *fiber.Ctx) error {
	type SetSecretRequest struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	authUsername := c.Locals("username").(string)
	if req.Username != authUsername {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	_, err := db.Exec(`
		INSERT INTO secrets (username, secret) VALUES (?, ?)
		ON CONFLICT(username) DO UPDATE SET secret = excluded.secret
	`, req.Username, req.Secret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecretHandler(c *fiber.Ctx) error {
	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Username is required"})
	}

	authUsername := c.Locals("username").(string)
	if username != authUsername {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	var secret string
	err := db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
	if err != nil {
		return c.Status(200).JSON(fiber.Map{"secret": ""})
	}

	return c.Status(200).JSON(fiber.Map{"secret": secret})
}