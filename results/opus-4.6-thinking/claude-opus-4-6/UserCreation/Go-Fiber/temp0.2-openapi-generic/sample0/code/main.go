package main

import (
	"database/sql"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_name TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			email TEXT UNIQUE NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS invitations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			invite_id TEXT UNIQUE NOT NULL,
			email TEXT UNIQUE NOT NULL,
			invited_by INTEGER,
			used INTEGER DEFAULT 0,
			FOREIGN KEY (invited_by) REFERENCES users(id)
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Seed an initial admin user if no users exist
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		log.Fatal(err)
	}
	if count == 0 {
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
		if err != nil {
			log.Fatal(err)
		}
		_, err = db.Exec("INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)", "admin", string(hashedPassword), "admin@example.com")
		if err != nil {
			log.Fatal(err)
		}
	}
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Missing authorization header"})
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid authorization header format"})
	}

	tokenString := parts[1]
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid signing method")
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid or expired token"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid token claims"})
	}

	userID, ok := claims["user_id"].(float64)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid token claims"})
	}

	c.Locals("user_id", int(userID))
	return c.Next()
}

func loginHandler(c *fiber.Ctx) error {
	type LoginRequest struct {
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}

	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	req.UserName = strings.TrimSpace(req.UserName)
	if req.UserName == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "user_name and password are required"})
	}

	var userID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM users WHERE user_name = ?", req.UserName).Scan(&userID, &passwordHash)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid credentials"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":   userID,
		"user_name": req.UserName,
	})

	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to generate token"})
	}

	return c.JSON(fiber.Map{"token": tokenString})
}

func inviteUserHandler(c *fiber.Ctx) error {
	type InviteRequest struct {
		Email string `json:"email"`
	}

	var req InviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Email is required"})
	}

	// Check if email already has a user account
	var existingUserCount int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&existingUserCount)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Database error"})
	}
	if existingUserCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Email already has an account"})
	}

	// Check if invitation already exists for this email
	var existingInviteID string
	err = db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	userID := c.Locals("user_id").(int)
	inviteID := uuid.New().String()

	_, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)", inviteID, req.Email, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to create invitation"})
	}

	return c.JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func createUserHandler(c *fiber.Ctx) error {
	type CreateUserRequest struct {
		InviteID string `json:"invite_id"`
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}

	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
	}

	req.InviteID = strings.TrimSpace(req.InviteID)
	req.UserName = strings.TrimSpace(req.UserName)

	if req.InviteID == "" || req.UserName == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "invite_id, user_name, and password are required"})
	}

	// Validate invite_id
	var inviteEmail string
	var used int
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&inviteEmail, &used)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
	}

	if used == 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
	}

	// Check if username already exists
	var existingCount int
	err = db.QueryRow("SELECT COUNT(*) FROM users WHERE user_name = ?", req.UserName).Scan(&existingCount)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Database error"})
	}
	if existingCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to hash password"})
	}

	// Create user
	_, err = db.Exec("INSERT INTO users (user_name, password_hash, email) VALUES (?, ?, ?)", req.UserName, string(hashedPassword), inviteEmail)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to create user"})
	}

	// Mark invitation as used
	_, err = db.Exec("UPDATE invitations SET used = 1 WHERE invite_id = ?", req.InviteID)
	if err != nil {
		log.Printf("Warning: failed to mark invitation as used: %v", err)
	}

	return c.JSON(fiber.Map{"message": "User created successfully"})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key-change-me"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	// Public endpoints
	app.Post("/login", loginHandler)
	app.Post("/create_user", createUserHandler)

	// Protected endpoints
	app.Post("/invite_user", authMiddleware, inviteUserHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}