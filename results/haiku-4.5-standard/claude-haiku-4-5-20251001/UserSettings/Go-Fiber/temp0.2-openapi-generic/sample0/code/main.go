package main

import (
	"database/sql"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var secret string

func main() {
	secret = os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "users.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, name TEXT)")

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Get("/profile", getProfile)
	app.Put("/profile", updateProfile)

	app.Listen(":5000")
}

func getUserFromToken(c *fiber.Ctx) int {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return 0
	}
	tokenStr := strings.TrimPrefix(auth, "Bearer ")
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return 0
	}
	claims := token.Claims.(jwt.MapClaims)
	return int(claims["user_id"].(float64))
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", body.Email, string(hashed), body.Name)
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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	var id int
	var hashedPw string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", body.Email).Scan(&id, &hashedPw)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if bcrypt.CompareHashAndPassword([]byte(hashedPw), []byte(body.Password)) != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"user_id": id})
	tokenStr, _ := token.SignedString([]byte(secret))
	return c.JSON(fiber.Map{"token": tokenStr})
}

func getProfile(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var id int
	var email, name string
	err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userId).Scan(&id, &email, &name)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"id": id, "email": email, "name": name})
}

func updateProfile(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email required"})
	}
	_, err := db.Exec("UPDATE users SET name = ?, email = ? WHERE id = ?", body.Name, body.Email, userId)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already in use"})
	}
	var id int
	var email, name string
	db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userId).Scan(&id, &email, &name)
	return c.JSON(fiber.Map{"id": id, "email": email, "name": name})
}
