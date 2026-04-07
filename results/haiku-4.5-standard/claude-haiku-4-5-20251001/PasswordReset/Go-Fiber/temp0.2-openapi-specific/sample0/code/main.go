package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var secret string
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

const resetTokenExpiry = 3600 // 1 hour in seconds

var rateLimitStoreData = struct {
	sync.Mutex
	data map[string][]time.Time
}{data: make(map[string][]time.Time)}

func rateLimit(maxRequests int, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		key := ip + ":" + c.Path()
		now := time.Now()
		rateLimitStoreData.Lock()
		times := rateLimitStoreData.data[key]
		var filtered []time.Time
		for _, t := range times {
			if now.Sub(t) < window {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= maxRequests {
			rateLimitStoreData.data[key] = filtered
			rateLimitStoreData.Unlock()
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded"})
		}
		filtered = append(filtered, now)
		rateLimitStoreData.data[key] = filtered
		rateLimitStoreData.Unlock()
		return c.Next()
	}
}

func generateSecureToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func main() {
	secret = os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "auth.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)")
	db.Exec("CREATE TABLE IF NOT EXISTS reset_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT UNIQUE NOT NULL, created_at REAL NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id))")

	app := fiber.New(fiber.Config{BodyLimit: 1024 * 1024})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		return c.Next()
	})

	app.Post("/register", rateLimit(10, time.Minute), register)
	app.Post("/login", rateLimit(10, time.Minute), login)
	app.Post("/forgot-password", rateLimit(5, time.Minute), forgotPassword)
	app.Post("/reset-password", rateLimit(5, time.Minute), resetPassword)

	app.Listen(":5000")
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	body.Email = strings.TrimSpace(body.Email)
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	if !emailRegex.MatchString(body.Email) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid email format"})
	}
	if len(body.Password) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "Password must be at least 8 characters"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", body.Email, string(hashed))
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already exists"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered"})
}

func login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	body.Email = strings.TrimSpace(body.Email)
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	var id int
	var hashedPw string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", body.Email).Scan(&id, &hashedPw)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if bcrypt.CompareHashAndPassword([]byte(hashedPw), []byte(body.Password)) != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": id,
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	tokenStr, _ := token.SignedString([]byte(secret))
	return c.JSON(fiber.Map{"token": tokenStr})
}

func forgotPassword(c *fiber.Ctx) error {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	body.Email = strings.TrimSpace(body.Email)
	if body.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email required"})
	}
	var userId int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", body.Email).Scan(&userId)
	if err != nil {
		// Return same response to prevent email enumeration
		return c.JSON(fiber.Map{"message": "If the email exists, a reset token has been sent"})
	}
	resetToken := generateSecureToken()
	db.Exec("DELETE FROM reset_tokens WHERE user_id = ?", userId)
	db.Exec("INSERT INTO reset_tokens (user_id, token, created_at) VALUES (?, ?, ?)", userId, resetToken, float64(time.Now().Unix()))
	return c.JSON(fiber.Map{"reset_token": resetToken})
}

func resetPassword(c *fiber.Ctx) error {
	var body struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Token == "" || body.NewPassword == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Token and new password required"})
	}
	if len(body.NewPassword) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "Password must be at least 8 characters"})
	}
	var userId int
	var createdAt float64
	err := db.QueryRow("SELECT user_id, created_at FROM reset_tokens WHERE token = ?", body.Token).Scan(&userId, &createdAt)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid token"})
	}
	// Check token expiry
	if float64(time.Now().Unix())-createdAt > float64(resetTokenExpiry) {
		db.Exec("DELETE FROM reset_tokens WHERE token = ?", body.Token)
		return c.Status(400).JSON(fiber.Map{"error": "Token expired"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), 12)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	db.Exec("UPDATE users SET password = ? WHERE id = ?", string(hashed), userId)
	db.Exec("DELETE FROM reset_tokens WHERE user_id = ?", userId)
	return c.JSON(fiber.Map{"message": "Password reset successful"})
}
