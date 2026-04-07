package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Password string `json:"-"`
	Role     string `json:"role"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type Claims struct {
	UserID int    `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		role TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateToken(user User) (string, error) {
	claims := &Claims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func authMiddleware(c *fiber.Ctx) error {
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
		tokenString = tokenString[7:]
	} else {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("claims", claims)
	return c.Next()
}

func adminMiddleware(c *fiber.Ctx) error {
	claims, ok := c.Locals("claims").(*Claims)
	if !ok || claims.Role != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden - admin access required"})
	}
	return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
	}

	// Check if user already exists
	var existingUser User
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUser.ID)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
	}

	// Determine role: first user is admin, others are users
	var userCount int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&userCount)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	role := "user"
	if userCount == 0 {
		role = "admin"
	}

	// Hash password
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)",
		req.Email, hashedPassword, role)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password, role FROM users WHERE email = ?",
		req.Email).Scan(&user.ID, &user.Email, &user.Password, &user.Role)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	token, err := generateToken(user)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(fiber.Map{"token": token})
}

func profileHandler(c *fiber.Ctx) error {
	claims := c.Locals("claims").(*Claims)
	
	return c.JSON(fiber.Map{
		"email": claims.Email,
		"role":  claims.Role,
	})
}

func listUsersHandler(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, email, role FROM users")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	users := []fiber.Map{}
	for rows.Next() {
		var user User
		if err := rows.Scan(&user.ID, &user.Email, &user.Role); err != nil {
			continue
		}
		users = append(users, fiber.Map{
			"id":    user.ID,
			"email": user.Email,
			"role":  user.Role,
		})
	}

	return c.JSON(users)
}

func deleteUserHandler(c *fiber.Ctx) error {
	idStr := c.Params("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}

	// Check if user exists
	var exists int
	err = db.QueryRow("SELECT COUNT(*) FROM users WHERE id = ?", id).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}

	// Delete user
	_, err = db.Exec("DELETE FROM users WHERE id = ?", id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(fiber.Map{"message": "User deleted"})
}

func main() {
	// Initialize JWT secret
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-change-in-production"
	}
	jwtSecret = []byte(secret)

	// Initialize database
	initDB()
	defer db.Close()

	// Create Fiber app
	app := fiber.New()

	// Public routes
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)

	// Protected routes
	app.Get("/profile", authMiddleware, profileHandler)

	// Admin routes
	admin := app.Group("/admin", authMiddleware, adminMiddleware)
	admin.Get("/users", listUsersHandler)
	admin.Delete("/users/:id", deleteUserHandler)

	// Start server
	fmt.Println("Server starting on 0.0.0.0:5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}