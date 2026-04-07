package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Password string `json:"-"`
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

type ProfileResponse struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type LoginResponse struct {
	Token   string `json:"token"`
	Message string `json:"message"`
}

func init() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret-key"
	}
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}

func generateToken(userID int, email string) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"email":   email,
		"exp":     time.Now().Add(time.Hour * 24).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(appSecret))
	return tokenString, err
}

func verifyToken(tokenString string) (jwt.MapClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, jwt.MapClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(appSecret), nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return claims, nil
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Missing authorization header"})
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || parts[0] != "Bearer" {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid authorization header"})
	}

	claims, err := verifyToken(parts[1])
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid token"})
	}

	c.Locals("user_id", int(claims["user_id"].(float64)))
	c.Locals("email", claims["email"].(string))

	return c.Next()
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Invalid request body"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Email, password, and name are required"})
	}

	hashedPassword := hashPassword(req.Password)

	_, err := db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email, hashedPassword, req.Name)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Email already in use or invalid data"})
		}
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Email already in use or invalid data"})
	}

	return c.Status(fiber.StatusCreated).JSON(MessageResponse{Message: "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	hashedPassword := hashPassword(req.Password)

	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Name)

	if err != nil || user.Password != hashedPassword {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	token, err := generateToken(user.ID, user.Email)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Invalid email or password"})
	}

	return c.Status(fiber.StatusOK).JSON(LoginResponse{
		Token:   token,
		Message: "Login successful",
	})
}

func getProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)

	var user User
	err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userID).
		Scan(&user.ID, &user.Email, &user.Name)

	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(MessageResponse{Message: "Unauthorized"})
	}

	return c.Status(fiber.StatusOK).JSON(ProfileResponse{
		Email: user.Email,
		Name:  user.Name,
	})
}

func updateProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)

	var req map[string]interface{}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Invalid request body"})
	}

	allowedFields := map[string]bool{"name": true, "email": true}
	for key := range req {
		if !allowedFields[key] {
			return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Invalid field"})
		}
	}

	var updates []string
	var args []interface{}

	if name, ok := req["name"].(string); ok && name != "" {
		updates = append(updates, "name = ?")
		args = append(args, name)
	}

	if email, ok := req["email"].(string); ok && email != "" {
		updates = append(updates, "email = ?")
		args = append(args, email)
	}

	if len(updates) == 0 {
		return c.Status(fiber.StatusOK).JSON(MessageResponse{Message: "Profile updated"})
	}

	args = append(args, userID)
	query := "UPDATE users SET " + strings.Join(updates, ", ") + " WHERE id = ?"

	_, err := db.Exec(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Email already in use"})
		}
		return c.Status(fiber.StatusBadRequest).JSON(MessageResponse{Message: "Failed to update profile"})
	}

	return c.Status(fiber.StatusOK).JSON(MessageResponse{Message: "Profile updated"})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		JSONEncoder: json.Marshal,
		JSONDecoder: json.Unmarshal,
	})

	app.Post("/register", register)
	app.Post("/login", login)

	app.Get("/profile", authMiddleware, getProfile)
	app.Put("/profile", authMiddleware, updateProfile)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}