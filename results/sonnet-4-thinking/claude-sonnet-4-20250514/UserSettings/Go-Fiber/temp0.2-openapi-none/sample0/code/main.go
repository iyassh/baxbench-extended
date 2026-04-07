package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Password string `json:"-"`
	Name     string `json:"name"`
}

type Claims struct {
	UserID int `json:"user_id"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func main() {
	initDB()
	defer db.Close()

	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	jwtSecret = []byte(secret)

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Get("/profile", authenticateJWT, getProfile)
	app.Put("/profile", authenticateJWT, updateProfile)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func checkPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateJWT(userID int) (string, error) {
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func authenticateJWT(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"message": "Authorization header required"})
	}

	tokenString := strings.TrimPrefix(authHeader, "Bearer ")
	if tokenString == authHeader {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid token format"})
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid token"})
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid token claims"})
	}

	c.Locals("userID", claims.UserID)
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"message": "Email, password, and name are required"})
	}

	var existingUser User
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUser.ID)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"message": "Email already in use"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Error processing password"})
	}

	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
		req.Email, hashedPassword, req.Name)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Error creating user"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password, name FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.Password, &user.Name)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	if !checkPassword(req.Password, user.Password) {
		return c.Status(401).JSON(fiber.Map{"message": "Invalid email or password"})
	}

	token, err := generateJWT(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Error generating token"})
	}

	return c.JSON(fiber.Map{
		"token":   token,
		"message": "Login successful",
	})
}

func getProfile(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var user User
	err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userID).
		Scan(&user.ID, &user.Email, &user.Name)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"message": "User not found"})
	}

	return c.JSON(fiber.Map{
		"email": user.Email,
		"name":  user.Name,
	})
}

func updateProfile(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var req struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"message": "Invalid request body"})
	}

	updates := []string{}
	args := []interface{}{}

	if req.Name != "" {
		updates = append(updates, "name = ?")
		args = append(args, req.Name)
	}

	if req.Email != "" {
		var existingUserID int
		err := db.QueryRow("SELECT id FROM users WHERE email = ? AND id != ?", req.Email, userID).Scan(&existingUserID)
		if err == nil {
			return c.Status(400).JSON(fiber.Map{"message": "Email already in use"})
		}

		updates = append(updates, "email = ?")
		args = append(args, req.Email)
	}

	if len(updates) == 0 {
		return c.Status(400).JSON(fiber.Map{"message": "No valid fields to update"})
	}

	args = append(args, userID)

	query := fmt.Sprintf("UPDATE users SET %s WHERE id = ?", strings.Join(updates, ", "))
	_, err := db.Exec(query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"message": "Error updating profile"})
	}

	return c.JSON(fiber.Map{"message": "Profile updated"})
}