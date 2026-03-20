package main

import (
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type InviteUserRequest struct {
	Email string `json:"email"`
}

type InviteUserResponse struct {
	InviteID string `json:"invite_id"`
	Message  string `json:"message"`
}

type CreateUserRequest struct {
	InviteID string `json:"invite_id"`
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

var db *sql.DB
var jwtSecret []byte

func init() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create tables
	createTables := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		email TEXT UNIQUE NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
		invited_by INTEGER NOT NULL,
		used BOOLEAN DEFAULT FALSE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (invited_by) REFERENCES users(id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}

	// Get JWT secret from environment
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	jwtSecret = []byte(secret)

	// Create initial admin user if no users exist
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		log.Fatal(err)
	}

	if count == 0 {
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		if err != nil {
			log.Fatal(err)
		}
		_, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
			"admin", string(hashedPassword), "admin@example.com")
		if err != nil {
			log.Fatal(err)
		}
	}
}

func authMiddleware(c *fiber.Ctx) error {
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Missing authorization header",
		})
	}

	if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
		tokenString = tokenString[7:]
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid token",
		})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid token claims",
		})
	}

	userID, ok := claims["user_id"].(float64)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid user_id in token",
		})
	}

	c.Locals("user_id", int(userID))
	return c.Next()
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if req.Email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email is required",
		})
	}

	userID := c.Locals("user_id").(int)

	// Check if user with this email already exists
	var existingUserCount int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&existingUserCount)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	if existingUserCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "User with this email already exists",
		})
	}

	// Check if invitation already exists
	var existingInviteID string
	err = db.QueryRow("SELECT invite_id FROM invitations WHERE email = ? AND used = FALSE", req.Email).Scan(&existingInviteID)
	if err == nil {
		// Invitation already exists
		return c.JSON(InviteUserResponse{
			InviteID: existingInviteID,
			Message:  "Invitation already exists",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
		inviteID, req.Email, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to create invitation",
		})
	}

	return c.JSON(InviteUserResponse{
		InviteID: inviteID,
		Message:  "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if req.InviteID == "" || req.UserName == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "All fields are required",
		})
	}

	// Validate invitation
	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid invite_id",
		})
	}

	if used {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{
			Message: "Invalid invite_id",
		})
	}

	// Check if username already exists
	var existingCount int
	err = db.QueryRow("SELECT COUNT(*) FROM users WHERE username = ?", req.UserName).Scan(&existingCount)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Database error",
		})
	}

	if existingCount > 0 {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{
			Message: "Username already exists. Try providing different username.",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to hash password",
		})
	}

	// Create user
	_, err = db.Exec("INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)",
		req.UserName, string(hashedPassword), email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to create user",
		})
	}

	// Mark invitation as used
	_, err = db.Exec("UPDATE invitations SET used = TRUE WHERE invite_id = ?", req.InviteID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to update invitation",
		})
	}

	return c.JSON(MessageResponse{
		Message: "User created successfully",
	})
}

func login(c *fiber.Ctx) error {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	var userID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM users WHERE username = ?", req.Username).Scan(&userID, &passwordHash)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid credentials",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid credentials",
		})
	}

	// Create JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Failed to create token",
		})
	}

	return c.JSON(fiber.Map{
		"token": tokenString,
	})
}

func main() {
	app := fiber.New()

	// Public routes
	app.Post("/create_user", createUser)
	app.Post("/login", login)

	// Protected routes
	app.Post("/invite_user", authMiddleware, inviteUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}