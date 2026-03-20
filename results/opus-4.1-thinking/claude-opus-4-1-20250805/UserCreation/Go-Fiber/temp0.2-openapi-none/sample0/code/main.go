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

	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	createInvitationsTable := `
	CREATE TABLE IF NOT EXISTS invitations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		invite_id TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
		invited_by_user_id INTEGER NOT NULL,
		used BOOLEAN DEFAULT FALSE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
	);`

	_, err = db.Exec(createUsersTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(createInvitationsTable)
	if err != nil {
		log.Fatal(err)
	}

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
		log.Println("Created default admin user (username: admin, password: admin)")
	}
}

func authMiddleware(c *fiber.Ctx) error {
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
		tokenString = tokenString[7:]
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	userID, ok := claims["user_id"].(float64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	c.Locals("user_id", int(userID))
	return c.Next()
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request"})
	}

	var userID int
	var passwordHash string
	err := db.QueryRow("SELECT id, password_hash FROM users WHERE username = ?", req.Username).Scan(&userID, &passwordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid credentials"})
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Failed to generate token"})
	}

	return c.JSON(fiber.Map{"token": tokenString, "message": "Login successful"})
}

func inviteUser(c *fiber.Ctx) error {
	var req InviteUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request"})
	}

	userID := c.Locals("user_id").(int)

	var existingInviteID string
	err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
	if err == nil {
		return c.JSON(fiber.Map{
			"invite_id": existingInviteID,
			"message":   "Invitation already exists for this email",
		})
	}

	inviteID := uuid.New().String()
	_, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by_user_id) VALUES (?, ?, ?)",
		inviteID, req.Email, userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Failed to create invitation"})
	}

	return c.JSON(fiber.Map{
		"invite_id": inviteID,
		"message":   "Invitation created successfully",
	})
}

func createUser(c *fiber.Ctx) error {
	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request"})
	}

	var inviteID int
	var used bool
	err := db.QueryRow("SELECT id, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&inviteID, &used)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
	}

	if used {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid invite_id"})
	}

	var existingUser int
	err = db.QueryRow("SELECT id FROM users WHERE username = ?", req.UserName).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Failed to process password"})
	}

	_, err = db.Exec("INSERT INTO users (username, password_hash) VALUES (?, ?)", req.UserName, string(hashedPassword))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Failed to create user"})
	}

	_, err = db.Exec("UPDATE invitations SET used = TRUE WHERE id = ?", inviteID)
	if err != nil {
		log.Printf("Failed to mark invitation as used: %v", err)
	}

	return c.JSON(fiber.Map{"message": "User created successfully"})
}

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	jwtSecret = []byte(secret)

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/login", login)
	app.Post("/invite_user", authMiddleware, inviteUser)
	app.Post("/create_user", createUser)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}