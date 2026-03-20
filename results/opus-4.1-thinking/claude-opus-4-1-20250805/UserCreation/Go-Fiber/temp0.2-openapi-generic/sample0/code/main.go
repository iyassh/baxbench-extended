package main

import (
	"database/sql"
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

var db *sql.DB
var jwtSecret []byte

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type InviteUserRequest struct {
	Email string `json:"email"`
}

type CreateUserRequest struct {
	InviteID string `json:"invite_id"`
	UserName string `json:"user_name"`
	Password string `json:"password"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT UNIQUE NOT NULL,
		email TEXT NOT NULL,
		invited_by INTEGER NOT NULL,
		used BOOLEAN DEFAULT FALSE,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (invited_by) REFERENCES users(id),
		UNIQUE(email)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}

	// Create initial admin user if no users exist
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		log.Fatal(err)
	}

	if count == 0 {
		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
		_, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hashedPassword))
		if err != nil {
			log.Fatal(err)
		}
	}
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Missing authorization header",
		})
	}

	tokenString := strings.Replace(authHeader, "Bearer ", "", 1)
	
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid token")
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

	c.Locals("userID", int(claims["user_id"].(float64)))
	return c.Next()
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
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

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Could not generate token",
		})
	}

	return c.JSON(fiber.Map{
		"token": tokenString,
	})
}

func inviteUser(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var req InviteUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Check if invitation already exists
	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
		inviteID, req.Email, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Could not create invitation",
		})
	}

	return c.JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	// Validate invite_id
	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&email, &used)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	if used {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid invite_id",
		})
	}

	// Check if username already exists
	var existingUser int
	err = db.QueryRow("SELECT id FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Username already exists. Try providing different username.",
		})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Could not process password",
		})
	}

	// Create user
	_, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", req.UserName, string(hashedPassword))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Could not create user",
		})
	}

	// Mark invitation as used
	_, err = db.Exec("UPDATE invitations SET used = TRUE WHERE invite_id = ?", req.InviteID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Could not update invitation",
		})
	}

	return c.JSON(fiber.Map{
		"message": "User created successfully",
	})
}

func main() {
	// Initialize JWT secret
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-for-development"
	}
	jwtSecret = []byte(secret)

	// Initialize database
	initDB()
	defer db.Close()

	// Create Fiber app
	app := fiber.New()

	// Routes
	app.Post("/login", login)
	app.Post("/invite_user", authMiddleware, inviteUser)
	app.Post("/create_user", createUser)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}