package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

type RegisterRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type SetSecretRequest struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

type Claims struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	jwt.RegisteredClaims
}

func init() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key-change-in-production"
	}

	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTablesSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS secrets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		secret TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id)
	);
	`

	_, err = db.Exec(createTablesSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if req.Email == "" || req.Username == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email, username and password are required",
		})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Error processing password",
		})
	}

	_, err = db.Exec(
		"INSERT INTO users (email, username, password) VALUES (?, ?, ?)",
		req.Email, req.Username, string(hashedPassword),
	)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Email already in use or invalid data",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Registration successful",
	})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	var userID int
	var username string
	var hashedPassword string
	err := db.QueryRow(
		"SELECT id, username, password FROM users WHERE email = ?",
		req.Email,
	).Scan(&userID, &username, &hashedPassword)

	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	err = bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid email or password",
		})
	}

	claims := &Claims{
		Email:    req.Email,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Error generating token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func verifyToken(c *fiber.Ctx) (*Claims, error) {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Missing authorization header")
	}

	tokenString := authHeader[7:]
	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid authorization header")
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return nil, fiber.NewError(fiber.StatusUnauthorized, "Invalid authentication token")
	}

	return claims, nil
}

func setSecret(c *fiber.Ctx) error {
	claims, err := verifyToken(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var req SetSecretRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"message": "Invalid request body",
		})
	}

	if req.Username != claims.Username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var userID int
	err = db.QueryRow("SELECT id FROM users WHERE username = ?", req.Username).Scan(&userID)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var existingID int
	err = db.QueryRow("SELECT id FROM secrets WHERE user_id = ?", userID).Scan(&existingID)

	if err == sql.ErrNoRows {
		_, err = db.Exec(
			"INSERT INTO secrets (user_id, secret) VALUES (?, ?)",
			userID, req.Secret,
		)
	} else if err == nil {
		_, err = db.Exec(
			"UPDATE secrets SET secret = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?",
			req.Secret, userID,
		)
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"message": "Error setting secret",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": "Secret has been set successfully",
	})
}

func getSecret(c *fiber.Ctx) error {
	claims, err := verifyToken(c)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	username := c.Query("username")
	if username != claims.Username {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var userID int
	err = db.QueryRow("SELECT id FROM users WHERE username = ?", username).Scan(&userID)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	var secret string
	err = db.QueryRow("SELECT secret FROM secrets WHERE user_id = ?", userID).Scan(&secret)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"message": "Invalid authentication token",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"secret": secret,
	})
}

func main() {
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/set_secret", setSecret)
	app.Get("/get_secret", getSecret)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}