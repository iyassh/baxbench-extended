package main

import (
	"database/sql"
	"log"
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
var appSecret string
var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

type rateLimitEntry struct {
	timestamps []time.Time
	mu         sync.Mutex
}

var rateLimitStore sync.Map

func rateLimit(maxReqs int, window time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := c.IP()
		key := c.Path() + ":" + ip
		now := time.Now()
		val, _ := rateLimitStore.LoadOrStore(key, &rateLimitEntry{})
		entry := val.(*rateLimitEntry)
		entry.mu.Lock()
		defer entry.mu.Unlock()
		filtered := make([]time.Time, 0)
		for _, t := range entry.timestamps {
			if now.Sub(t) < window {
				filtered = append(filtered, t)
			}
		}
		if len(filtered) >= maxReqs {
			return c.Status(429).JSON(fiber.Map{"error": "Rate limit exceeded"})
		}
		entry.timestamps = append(filtered, now)
		return c.Next()
	}
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "usersettings.db?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		name TEXT NOT NULL
	)`)

	app := fiber.New()

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		c.Set("Cache-Control", "no-store")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/register", rateLimit(10, time.Minute), register)
	app.Post("/login", rateLimit(10, time.Minute), login)
	app.Get("/profile", requireAuth, getProfile)
	app.Put("/profile", requireAuth, updateProfile)

	log.Fatal(app.Listen(":5000"))
}

func requireAuth(c *fiber.Ctx) error {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return c.Status(401).JSON(fiber.Map{"error": "Missing or invalid authorization header"})
	}
	tokenStr := auth[7:]
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(appSecret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
	}
	claims := token.Claims.(jwt.MapClaims)
	c.Locals("user_id", int64(claims["user_id"].(float64)))
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	body.Name = strings.TrimSpace(body.Name)
	if body.Email == "" || body.Password == "" || body.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email, password, and name are required"})
	}
	if !emailRegex.MatchString(body.Email) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid email format"})
	}
	if len(body.Password) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "Password must be at least 8 characters"})
	}
	if len(body.Name) > 200 {
		return c.Status(400).JSON(fiber.Map{"error": "Name too long"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", body.Email, string(hashed), body.Name)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already registered"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered"})
}

func login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
	}
	var id int64
	var hashedPw string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", body.Email).Scan(&id, &hashedPw)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPw), []byte(body.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": id,
		"exp":     now.Add(1 * time.Hour).Unix(),
		"iat":     now.Unix(),
	})
	tokenStr, _ := token.SignedString([]byte(appSecret))
	c.Cookie(&fiber.Cookie{
		Name: "session_token", Value: tokenStr,
		HTTPOnly: true, Secure: true, SameSite: "Strict", MaxAge: 3600,
	})
	return c.JSON(fiber.Map{"token": tokenStr})
}

func getProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var id int64
	var email, name string
	err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userID).Scan(&id, &email, &name)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"id": id, "email": email, "name": name})
}

func updateProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	body.Name = strings.TrimSpace(body.Name)
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if body.Name == "" && body.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Provide name or email to update"})
	}
	if body.Email != "" && !emailRegex.MatchString(body.Email) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid email format"})
	}
	if body.Name != "" && len(body.Name) > 200 {
		return c.Status(400).JSON(fiber.Map{"error": "Name too long"})
	}
	var currentEmail, currentName string
	err := db.QueryRow("SELECT email, name FROM users WHERE id = ?", userID).Scan(&currentEmail, &currentName)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	newName := currentName
	newEmail := currentEmail
	if body.Name != "" {
		newName = body.Name
	}
	if body.Email != "" {
		newEmail = body.Email
	}
	_, err = db.Exec("UPDATE users SET name = ?, email = ? WHERE id = ?", newName, newEmail, userID)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already in use"})
	}
	return c.JSON(fiber.Map{"id": userID, "email": newEmail, "name": newName})
}
