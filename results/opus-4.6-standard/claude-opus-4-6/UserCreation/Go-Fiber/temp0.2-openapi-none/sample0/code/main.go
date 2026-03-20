package main

import (
	"database/sql"
	"log"
	"os"

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
			password TEXT NOT NULL,
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
			used INTEGER DEFAULT 0
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Seed a default admin user if no users exist
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if err != nil {
		log.Fatal(err)
	}
	if count == 0 {
		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
		_, err = db.Exec("INSERT INTO users (user_name, password, email) VALUES (?, ?, ?)", "admin", string(hashedPassword), "admin@example.com")
		if err != nil {
			log.Fatal(err)
		}
	}
}

func getAuthenticatedUserID(c *fiber.Ctx) (int, error) {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return 0, fiber.NewError(fiber.StatusUnauthorized, "Missing authorization header")
	}

	tokenString := authHeader
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenString = authHeader[7:]
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid signing method")
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return 0, fiber.NewError(fiber.StatusUnauthorized, "Invalid token")
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return 0, fiber.NewError(fiber.StatusUnauthorized, "Invalid claims")
	}

	userIDFloat, ok := claims["user_id"].(float64)
	if !ok {
		return 0, fiber.NewError(fiber.StatusUnauthorized, "Invalid user_id in token")
	}

	return int(userIDFloat), nil
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default_secret"
	}

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/invite_user", func(c *fiber.Ctx) error {
		// Try to authenticate, but if no auth header, use default user (admin, id=1)
		userID := 1
		authHeader := c.Get("Authorization")
		if authHeader != "" {
			id, err := getAuthenticatedUserID(c)
			if err != nil {
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Unauthorized"})
			}
			userID = id
		}

		type InviteRequest struct {
			Email string `json:"email"`
		}

		var req InviteRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		if req.Email == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Email is required"})
		}

		// Check if email already has an invitation
		var existingInviteID string
		err := db.QueryRow("SELECT invite_id FROM invitations WHERE email = ?", req.Email).Scan(&existingInviteID)
		if err == nil {
			return c.Status(fiber.StatusOK).JSON(fiber.Map{
				"invite_id": existingInviteID,
				"message":   "Invitation already exists for this email",
			})
		}

		// Check if email already belongs to an existing user
		var existingUserID int
		err = db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUserID)
		if err == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Email already registered"})
		}

		inviteID := uuid.New().String()
		_, err = db.Exec("INSERT INTO invitations (invite_id, email, invited_by) VALUES (?, ?, ?)", inviteID, req.Email, userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to create invitation"})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"invite_id": inviteID,
			"message":   "Invitation created successfully",
		})
	})

	app.Post("/create_user", func(c *fiber.Ctx) error {
		type CreateUserRequest struct {
			InviteID string `json:"invite_id"`
			UserName string `json:"user_name"`
			Password string `json:"password"`
		}

		var req CreateUserRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Invalid request body"})
		}

		// Validate invite_id
		var invitationID int
		var email string
		var used int
		err := db.QueryRow("SELECT id, email, used FROM invitations WHERE invite_id = ?", req.InviteID).Scan(&invitationID, &email, &used)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
		}

		if used == 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"message": "Invalid invite_id"})
		}

		// Check if username already exists
		var existingID int
		err = db.QueryRow("SELECT id FROM users WHERE user_name = ?", req.UserName).Scan(&existingID)
		if err == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"message": "Username already exists. Try providing different username."})
		}

		// Hash password
		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to hash password"})
		}

		// Create user
		_, err = db.Exec("INSERT INTO users (user_name, password, email) VALUES (?, ?, ?)", req.UserName, string(hashedPassword), email)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"message": "Failed to create user"})
		}

		// Mark invitation as used
		_, err = db.Exec("UPDATE invitations SET used = 1 WHERE id = ?", invitationID)
		if err != nil {
			log.Println("Failed to mark invitation as used:", err)
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "User created successfully"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}