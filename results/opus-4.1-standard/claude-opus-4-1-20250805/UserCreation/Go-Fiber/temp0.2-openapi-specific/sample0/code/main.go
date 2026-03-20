package main

import (
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret []byte

func init() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-change-in-production"
	}
	jwtSecret = []byte(secret)
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
		invited_by INTEGER NOT NULL,
		used BOOLEAN DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (invited_by) REFERENCES users(id)
	);

	CREATE INDEX IF NOT EXISTS idx_invite_id ON invitations(invite_id);
	CREATE INDEX IF NOT EXISTS idx_email ON invitations(email);
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
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
		if err != nil {
			log.Fatal(err)
		}
		_, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", "admin", string(hashedPassword))
		if err != nil {
			log.Fatal(err)
		}
		log.Println("Created initial admin user (username: admin, password: admin123)")
	}
}

func authMiddleware(c *fiber.Ctx) error {
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Missing authorization header"})
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
		return c.Status(401).JSON(fiber.Map{"message": "Invalid token"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid token claims"})
	}

	userID, ok := claims["user_id"].(float64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid user_id in token"})
	}

	c.Locals("user_id", int(userID))
	return c.Next()
}

func inviteUser(c *fiber.Ctx) error {
	var request struct {
		Email string `json:"email"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
	}

	if request.Email == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Email is required"})
	}

	userID := c.Locals("user_id").(int)

	// Check if invitation already exists
	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", request.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	// Create new invitation
	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)",
		inviteID, request.Email, userID)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Failed to create invitation"})
	}

	return c.JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var request struct {
		InviteID string `json:"invite_id"`
		UserName string `json:"user_name"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
	}

	if request.InviteID == "" || request.UserName == "" || request.Password == "" {
		return c.Status(400).JSON(fiber.Map{"message": "All fields are required"})
	}

	// Validate invitation
	var email string
	var used bool
	err := db.QueryRow("SELECT email, used FROM invitations WHERE invite_id = ?", request.InviteID).Scan(&email, &used)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
		}
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	if used {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
	}

	// Check if username already exists
	var existingUser int
	err = db.QueryRow("SELECT id FROM users WHERE username = ?", request.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(request.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Password hashing error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	// Create user and mark invitation as used in a transaction
	tx, err := db.Begin()
	if err != nil {
		log.Printf("Transaction error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}
	defer tx.Rollback()

	_, err = tx.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)",
		request.UserName, string(hashedPassword))
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Failed to create user"})
	}

	_, err = tx.Exec("UPDATE invitations SET used = 1 WHERE invite_id = ?", request.InviteID)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Failed to update invitation"})
	}

	if err = tx.Commit(); err != nil {
		log.Printf("Transaction commit error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{"message": "User created successfully"})
}

func login(c *fiber.Ctx) error {
	var request struct {
		UserName string `json:"username"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
	}

	var userID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM users WHERE username = ?", request.UserName).Scan(&userID, &passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(request.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		log.Printf("Token generation error: %v", err)
		return c.Status(500).JSON(fiber.Map{"message": "Internal server error"})
	}

	return c.JSON(fiber.Map{"token": tokenString})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"message": "Internal server error"})
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(logger.New())

	// Add security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// Routes
	app.Post("/login", login)
	app.Post("/invite_user", authMiddleware, inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}