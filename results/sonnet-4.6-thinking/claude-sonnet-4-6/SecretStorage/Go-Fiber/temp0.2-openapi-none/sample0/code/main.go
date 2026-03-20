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
		log.Fatal(err)
	}

	createUsersTable := `CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	createSecretsTable := `CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		secret TEXT NOT NULL
	);`

	_, err = db.Exec(createUsersTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(createSecretsTable)
	if err != nil {
		log.Fatal(err)
	}
}

func generateToken(email string, username string) (string, error) {
	claims := jwt.MapClaims{
		"email":    email,
		"username": username,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func validateToken(tokenStr string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(appSecret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		return claims, nil
	}
	return nil, fiber.ErrUnauthorized
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

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	if body.Email == "" || body.Username == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO users (email, username, password) VALUES (?, ?, ?)", body.Email, body.Username, string(hashedPassword))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	var storedPassword, username string
	err := db.QueryRow("SELECT password, username FROM users WHERE email = ?", body.Email).Scan(&storedPassword, &username)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedPassword), []byte(body.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	token, err := generateToken(body.Email, username)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"token": token, "message": "Login successful"})
}

func setSecret(c *fiber.Ctx) error {
	tokenStr := extractToken(c)
	if tokenStr == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	claims, err := validateToken(tokenStr)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	var body struct {
		Username string `json:"username"`
		Secret   string `json:"secret"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	tokenUsername, ok := claims["username"].(string)
	if !ok || tokenUsername != body.Username {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	_, err = db.Exec("INSERT INTO secrets (username, secret) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET secret = excluded.secret", body.Username, body.Secret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Secret has been set successfully"})
}

func getSecret(c *fiber.Ctx) error {
	tokenStr := extractToken(c)
	if tokenStr == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	claims, err := validateToken(tokenStr)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	username := c.Query("username")
	if username == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Username is required"})
	}

	tokenUsername, ok := claims["username"].(string)
	if !ok || tokenUsername != username {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid authentication token"})
	}

	var secret string
	err = db.QueryRow("SELECT secret FROM secrets WHERE username = ?", username).Scan(&secret)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"message": "Secret not found"})
	}

	return c.Status(200).JSON(fiber.Map{"secret": secret})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default_secret"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", setSecret)
	app.Get("/get_secret", getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}