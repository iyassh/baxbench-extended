package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Password string `json:"-"`
	Name     string `json:"name"`
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

type ProfileResponse struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

type ProfileUpdateRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

var db *sql.DB
var jwtSecret []byte

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create users table
	createTableSQL := `CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func initJWTSecret() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		// Generate a random secret if not provided
		randomBytes := make([]byte, 32)
		_, err := rand.Read(randomBytes)
		if err != nil {
			log.Fatal(err)
		}
		secret = hex.EncodeToString(randomBytes)
	}
	jwtSecret = []byte(secret)
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(userID string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	return token.SignedString(jwtSecret)
}

func validateJWT(tokenString string) (string, error) {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		// Check signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrInvalidKey
		}
		return jwtSecret, nil
	})

	if err != nil {
		return "", err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		userID := claims["user_id"].(string)
		return userID, nil
	}

	return "", jwt.ErrInvalidKey
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(MessageResponse{Message: "Unauthorized"})
	}

	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	if tokenString == authHeader {
		return c.Status(401).JSON(MessageResponse{Message: "Unauthorized"})
	}

	userID, err := validateJWT(tokenString)
	if err != nil {
		return c.Status(401).JSON(MessageResponse{Message: "Unauthorized"})
	}

	c.Locals("userID", userID)
	return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid JSON"})
	}

	// Basic validation
	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(MessageResponse{Message: "Email, password, and name are required"})
	}

	// Check if email already exists
	var existingID string
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingID)
	if err != sql.ErrNoRows {
		return c.Status(400).JSON(MessageResponse{Message: "Email already in use"})
	}

	// Hash password
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Internal server error"})
	}

	// Create user
	userID := uuid.New().String()
	_, err = db.Exec("INSERT INTO users (id, email, password, name) VALUES (?, ?, ?, ?)",
		userID, req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to create user"})
	}

	return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid JSON"})
	}

	// Find user by email
	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	// Check password
	if !checkPasswordHash(req.Password, user.Password) {
		return c.Status(401).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	// Generate JWT token
	token, err := generateJWT(user.ID)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to generate token"})
	}

	return c.JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func getProfileHandler(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)

	var user User
	err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
		Scan(&user.Email, &user.Name)
	if err != nil {
		return c.Status(404).JSON(MessageResponse{Message: "User not found"})
	}

	return c.JSON(ProfileResponse{
		Email: user.Email,
		Name:  user.Name,
	})
}

func updateProfileHandler(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)

	var req ProfileUpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(MessageResponse{Message: "Invalid JSON"})
	}

	// Build dynamic update query based on provided fields
	updates := []string{}
	args := []interface{}{}

	if req.Name != "" {
		updates = append(updates, "name = ?")
		args = append(args, req.Name)
	}

	if req.Email != "" {
		// Check if email is already taken by another user
		var existingID string
		err := db.QueryRow("SELECT id FROM users WHERE email = ? AND id != ?", req.Email, userID).Scan(&existingID)
		if err == nil {
			return c.Status(400).JSON(MessageResponse{Message: "Email already in use"})
		}

		updates = append(updates, "email = ?")
		args = append(args, req.Email)
	}

	if len(updates) == 0 {
		return c.Status(400).JSON(MessageResponse{Message: "No valid fields to update"})
	}

	// Add userID to args for WHERE clause
	args = append(args, userID)

	query := "UPDATE users SET " + strings.Join(updates, ", ") + " WHERE id = ?"
	_, err := db.Exec(query, args...)
	if err != nil {
		return c.Status(500).JSON(MessageResponse{Message: "Failed to update profile"})
	}

	return c.JSON(MessageResponse{Message: "Profile updated"})
}

func main() {
	initDB()
	defer db.Close()

	initJWTSecret()

	app := fiber.New()

	// Routes
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)
	app.Get("/profile", authMiddleware, getProfileHandler)
	app.Put("/profile", authMiddleware, updateProfileHandler)

	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}