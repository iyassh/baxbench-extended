package main

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "usersettings.db?_journal_mode=WAL")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	)`)

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Get("/profile", requireAuth, getProfile)
	app.Put("/profile", requireAuth, updateProfile)

	log.Fatal(app.Listen(":5000"))
}

func hashPassword(password string) string {
	h := sha256.Sum256([]byte(password))
	return fmt.Sprintf("%x", h)
}

func requireAuth(c *fiber.Ctx) error {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return c.Status(401).JSON(fiber.Map{"error": "Missing token"})
	}
	tokenStr := auth[7:]
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(appSecret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
	}
	claims := token.Claims.(jwt.MapClaims)
	c.Locals("user_id", int64(claims["user_id"].(float64)))
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if body.Email == "" || body.Password == "" || body.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email, password, and name are required"})
	}
	hashed := hashPassword(body.Password)
	_, err := db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", body.Email, hashed, body.Name)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already exists"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered"})
}

func login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	hashed := hashPassword(body.Password)
	var id int64
	err := db.QueryRow("SELECT id FROM users WHERE email = ? AND password = ?", body.Email, hashed).Scan(&id)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"user_id": id})
	tokenStr, _ := token.SignedString([]byte(appSecret))
	return c.JSON(fiber.Map{"token": tokenStr})
}

func getProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var id int64
	var email, name string
	err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userID).Scan(&id, &email, &name)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"id": id, "email": email, "name": name})
}

func updateProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if body.Name == "" && body.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Provide name or email to update"})
	}
	var currentEmail, currentName string
	err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).Scan(&currentEmail, &currentName)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	newName := currentName
	newEmail := currentEmail
	if body.Name != "" {
		newName = body.Name
	}
	if body.Email != "" {
		newEmail = body.Email
	}
	_, err = db.Exec("UPDATE users SET name = ?, email = ? WHERE id = ?", newName, newEmail, userID)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already in use"})
	}
	return c.JSON(fiber.Map{"id": userID, "email": newEmail, "name": newName})
}
