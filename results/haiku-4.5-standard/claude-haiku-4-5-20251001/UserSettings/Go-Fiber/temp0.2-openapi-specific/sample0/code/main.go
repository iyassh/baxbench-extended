package main

import (
	"database/sql"
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

func main() {
	secret = os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "users.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT)")

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
	app.Get("/profile", rateLimit(30, time.Minute), getProfile)
	app.Put("/profile", rateLimit(30, time.Minute), updateProfile)

	app.Listen(":5000")
}

func getUserFromToken(c *fiber.Ctx) int {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return 0
	}
	tokenStr := strings.TrimPrefix(auth, "Bearer ")
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return 0
	}
	claims := token.Claims.(jwt.MapClaims)
	return int(claims["user_id"].(float64))
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	body.Email = strings.TrimSpace(body.Email)
	body.Name = strings.TrimSpace(body.Name)
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	if !emailRegex.MatchString(body.Email) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid email format"})
	}
	if len(body.Password) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "Password must be at least 8 characters"})
	}
	if len(body.Name) > 100 {
		return c.Status(400).JSON(fiber.Map{"error": "Name too long"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	_, err = db.Exec("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", body.Email, string(hashed), body.Name)
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

func getProfile(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var id int
	var email, name string
	err := db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userId).Scan(&id, &email, &name)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"id": id, "email": email, "name": name})
}

func updateProfile(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	body.Email = strings.TrimSpace(body.Email)
	body.Name = strings.TrimSpace(body.Name)
	if body.Email == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email required"})
	}
	if !emailRegex.MatchString(body.Email) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid email format"})
	}
	if len(body.Name) > 100 {
		return c.Status(400).JSON(fiber.Map{"error": "Name too long"})
	}
	_, err := db.Exec("UPDATE users SET name = ?, email = ? WHERE id = ?", body.Name, body.Email, userId)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already in use"})
	}
	var id int
	var email, name string
	db.QueryRow("SELECT id, email, name FROM users WHERE id = ?", userId).Scan(&id, &email, &name)
	return c.JSON(fiber.Map{"id": id, "email": email, "name": name})
}
