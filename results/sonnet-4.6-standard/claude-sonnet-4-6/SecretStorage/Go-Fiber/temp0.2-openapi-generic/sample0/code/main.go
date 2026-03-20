package main

import (
	"database/sql"
	"log"
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
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		secret TEXT DEFAULT ''
	);`

	_, err = db.Exec(createUsersTable)
	if err != nil {
		log.Fatal("Failed to create users table:", err)
	}
}

func generateToken(username string) (string, error) {
	claims := jwt.MapClaims{
		"username": username,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func validateToken(tokenStr string) (string, error) {
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(appSecret), nil
	})
	if err != nil || !token.Valid {
		return "", fiber.ErrUnauthorized
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", fiber.ErrUnauthorized
	}
	username, ok := claims["username"].(string)
	if !ok {
		return "", fiber.ErrUnauthorized
	}
	return username, nil
}

func extractToken(c *fiber.Ctx) string {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return ""
	}
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	return parts[1]
}

func registerHandler(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if body.Email == "" || body.Username == "" || body.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		body.Email, body.Username, string(hashedPassword))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func loginHandler(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	var username, hashedPassword string
	err := db.QueryRow("SELECT username, password FROM users WHERE email = ?", body.Email).
		Scan(&username, &hashedPassword)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(body.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	token, err := generateToken(username)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func setSecretHandler(c *fiber.Ctx) error {
	tokenStr := extractToken(c)
	if tokenStr == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenUsername, err := validateToken(tokenStr)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var body struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if body.Username != tokenUsername {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	result, err := db.Exec("UPDATE users SET secret = ? WHERE username = ?", body.Secret, body.Username)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Internal server error",
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecretHandler(c *fiber.Ctx) error {
	tokenStr := extractToken(c)
	if tokenStr == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	tokenUsername, err := validateToken(tokenStr)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	username := c.Query("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username is required",
		})
	}

	if username != tokenUsername {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var secret string
	err = db.QueryRow("SELECT secret FROM users WHERE username = ?", username).Scan(&secret)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"secret": secret,
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
	app.Post("/set_secret", setSecretHandler)
	app.Get("/get_secret", getSecretHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}