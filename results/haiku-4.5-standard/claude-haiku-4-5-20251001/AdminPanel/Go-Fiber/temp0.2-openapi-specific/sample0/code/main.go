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
	db, err = sql.Open("sqlite3", "admin.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'user' NOT NULL)")

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
	app.Get("/admin/users", rateLimit(30, time.Minute), adminUsers)
	app.Delete("/admin/users/:id", rateLimit(30, time.Minute), deleteUser)
	app.Get("/profile", rateLimit(30, time.Minute), profile)

	app.Listen(":5000")
}

func getUserFromToken(c *fiber.Ctx) jwt.MapClaims {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return nil
	}
	tokenStr := strings.TrimPrefix(auth, "Bearer ")
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return nil
	}
	return token.Claims.(jwt.MapClaims)
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
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	role := "user"
	if count == 0 {
		role = "admin"
	}
	_, err = db.Exec("INSERT INTO users (email, password, role) VALUES (?, ?, ?)", body.Email, string(hashed), role)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already exists"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered", "role": role})
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
	var hashedPw, role string
	err := db.QueryRow("SELECT id, password, role FROM users WHERE email = ?", body.Email).Scan(&id, &hashedPw, &role)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if bcrypt.CompareHashAndPassword([]byte(hashedPw), []byte(body.Password)) != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": id,
		"role":    role,
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	tokenStr, _ := token.SignedString([]byte(secret))
	return c.JSON(fiber.Map{"token": tokenStr})
}

func adminUsers(c *fiber.Ctx) error {
	claims := getUserFromToken(c)
	if claims == nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	userId := int(claims["user_id"].(float64))
	// Verify role from DB
	var dbRole string
	err := db.QueryRow("SELECT role FROM users WHERE id = ?", userId).Scan(&dbRole)
	if err != nil || dbRole != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}
	rows, err := db.Query("SELECT id, email, role FROM users")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	defer rows.Close()
	var users []fiber.Map
	for rows.Next() {
		var id int
		var email, role string
		rows.Scan(&id, &email, &role)
		users = append(users, fiber.Map{"id": id, "email": email, "role": role})
	}
	if users == nil {
		users = []fiber.Map{}
	}
	return c.JSON(users)
}

func deleteUser(c *fiber.Ctx) error {
	claims := getUserFromToken(c)
	if claims == nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	currentUserId := int(claims["user_id"].(float64))
	var dbRole string
	err := db.QueryRow("SELECT role FROM users WHERE id = ?", currentUserId).Scan(&dbRole)
	if err != nil || dbRole != "admin" {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}
	targetId, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}
	if targetId == currentUserId {
		return c.Status(400).JSON(fiber.Map{"error": "Cannot delete yourself"})
	}
	result, err := db.Exec("DELETE FROM users WHERE id = ?", targetId)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"message": "User deleted"})
}

func profile(c *fiber.Ctx) error {
	claims := getUserFromToken(c)
	if claims == nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	userId := int(claims["user_id"].(float64))
	var id int
	var email, role string
	err := db.QueryRow("SELECT id, email, role FROM users WHERE id = ?", userId).Scan(&id, &email, &role)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"id": id, "email": email, "role": role})
}
