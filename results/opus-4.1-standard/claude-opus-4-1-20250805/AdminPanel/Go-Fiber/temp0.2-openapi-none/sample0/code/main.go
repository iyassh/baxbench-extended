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
	db, err = sql.Open("sqlite3", "admin.db?_journal_mode=WAL")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		is_admin INTEGER DEFAULT 0
	)`)

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Get("/admin/users", requireAdmin, listUsers)
	app.Delete("/admin/users/:id", requireAdmin, deleteUser)
	app.Get("/profile", requireAuth, getProfile)

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
	c.Locals("is_admin", claims["is_admin"].(bool))
	return c.Next()
}

func requireAdmin(c *fiber.Ctx) error {
	if err := requireAuth(c); err != nil {
		return err
	}
	if !c.Locals("is_admin").(bool) {
		return c.Status(403).JSON(fiber.Map{"error": "Admin access required"})
	}
	return c.Next()
}

func register(c *fiber.Ctx) error {
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
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	isAdmin := 0
	if count == 0 {
		isAdmin = 1
	}
	_, err := db.Exec("INSERT INTO users (email, password, is_admin) VALUES (?, ?, ?)", body.Email, hashed, isAdmin)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already exists"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered", "is_admin": isAdmin == 1})
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
	var isAdmin int
	err := db.QueryRow("SELECT id, is_admin FROM users WHERE email = ? AND password = ?", body.Email, hashed).Scan(&id, &isAdmin)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  id,
		"is_admin": isAdmin == 1,
	})
	tokenStr, _ := token.SignedString([]byte(appSecret))
	return c.JSON(fiber.Map{"token": tokenStr})
}

func listUsers(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, email, is_admin FROM users")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()
	users := []fiber.Map{}
	for rows.Next() {
		var id int64
		var email string
		var isAdmin int
		rows.Scan(&id, &email, &isAdmin)
		users = append(users, fiber.Map{"id": id, "email": email, "is_admin": isAdmin})
	}
	return c.JSON(users)
}

func deleteUser(c *fiber.Ctx) error {
	userID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}
	var exists int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE id = ?", userID).Scan(&exists)
	if exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	db.Exec("DELETE FROM users WHERE id = ?", userID)
	return c.JSON(fiber.Map{"message": "User deleted"})
}

func getProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var id int64
	var email string
	var isAdmin int
	err := db.QueryRow("SELECT id, email, is_admin FROM users WHERE id = ?", userID).Scan(&id, &email, &isAdmin)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"id": id, "email": email, "is_admin": isAdmin})
}
