package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

type User struct {
	ID           int       `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Name         string    `json:"name"`
	CreatedAt    time.Time `json:"-"`
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

type ProfileUpdateRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type Claims struct {
	UserID int `json:"user_id"`
	jwt.RegisteredClaims
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.Next()
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" || len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	tokenString := authHeader[7:]
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unauthorized")
		}
		return []byte(appSecret), nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	c.Locals("userID", claims.UserID)
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	_, err = db.Exec("INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
		req.Email, string(hashedPassword), req.Name)

	if err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use or invalid data"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password_hash, name FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Name)

	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	claims := &Claims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appSecret))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	return c.JSON(fiber.Map{
		"token":   tokenString,
		"message": "Login successful",
	})
}

func getProfile(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var user User
	err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).
		Scan(&user.Email, &user.Name)

	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Unauthorized"})
	}

	return c.JSON(fiber.Map{
		"email": user.Email,
		"name":  user.Name,
	})
}

func updateProfile(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var bodyMap map[string]interface{}
	if err := json.Unmarshal(c.Body(), &bodyMap); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	var req ProfileUpdateRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	allowedFields := map[string]bool{"name": true, "email": true}
	for key := range bodyMap {
		if !allowedFields[key] {
			return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
		}
	}

	updates := ""
	args := []interface{}{}

	if req.Name != "" {
		if updates != "" {
			updates += ", "
		}
		updates += "name = ?"
		args = append(args, req.Name)
	}

	if req.Email != "" {
		if updates != "" {
			updates += ", "
		}
		updates += "email = ?"
		args = append(args, req.Email)
	}

	if updates == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	args = append(args, userID)
	query := "UPDATE users SET " + updates + " WHERE id = ?"

	_, err := db.Exec(query, args...)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid data"})
	}

	return c.JSON(fiber.Map{"message": "Profile updated"})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}

	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"message": "An error occurred"})
		},
	})

	app.Use(securityHeadersMiddleware)

	app.Post("/register", register)
	app.Post("/login", login)
	app.Get("/profile", authMiddleware, getProfile)
	app.Put("/profile", authMiddleware, updateProfile)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}