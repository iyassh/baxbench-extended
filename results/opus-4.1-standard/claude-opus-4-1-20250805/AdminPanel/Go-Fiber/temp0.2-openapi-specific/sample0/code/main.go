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
	db, err = sql.Open("sqlite3", "admin.db?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		is_admin INTEGER DEFAULT 0
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
	app.Get("/admin/users", requireAdmin, listUsers)
	app.Delete("/admin/users/:id", requireAdmin, deleteUser)
	app.Get("/profile", requireAuth, getProfile)

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
	userID := int64(claims["user_id"].(float64))
	// Verify admin status from DB
	var isAdmin int
	err = db.QueryRow("SELECT is_admin FROM users WHERE id = ?", userID).Scan(&isAdmin)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "User not found"})
	}
	c.Locals("user_id", userID)
	c.Locals("is_admin", isAdmin == 1)
	return c.Next()
}

func requireAdmin(c *fiber.Ctx) error {
	if err := requireAuth(c); err != nil {
		return err
	}
	if !c.Locals("is_admin").(bool) {
		return c.Status(403).JSON(fiber.Map{"error": "Admin access required"})
	}
	return c.Next()
}

func register(c *fiber.Ctx) error {
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
	if !emailRegex.MatchString(body.Email) {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid email format"})
	}
	if len(body.Password) < 8 {
		return c.Status(400).JSON(fiber.Map{"error": "Password must be at least 8 characters"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	isAdmin := 0
	if count == 0 {
		isAdmin = 1
	}
	_, err = db.Exec("INSERT INTO users (email, password, is_admin) VALUES (?, ?, ?)", body.Email, string(hashed), isAdmin)
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already registered"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered", "is_admin": isAdmin == 1})
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
	var isAdmin int
	err := db.QueryRow("SELECT id, password, is_admin FROM users WHERE email = ?", body.Email).Scan(&id, &hashedPw, &isAdmin)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPw), []byte(body.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  id,
		"is_admin": isAdmin == 1,
		"exp":      now.Add(1 * time.Hour).Unix(),
		"iat":      now.Unix(),
	})
	tokenStr, _ := token.SignedString([]byte(appSecret))
	c.Cookie(&fiber.Cookie{
		Name:     "session_token",
		Value:    tokenStr,
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
		MaxAge:   3600,
	})
	return c.JSON(fiber.Map{"token": tokenStr})
}

func listUsers(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, email, is_admin FROM users")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch users"})
	}
	defer rows.Close()
	users := []fiber.Map{}
	for rows.Next() {
		var id int64
		var email string
		var isAdmin int
		rows.Scan(&id, &email, &isAdmin)
		users = append(users, fiber.Map{"id": id, "email": email, "is_admin": isAdmin})
	}
	return c.JSON(users)
}

func deleteUser(c *fiber.Ctx) error {
	currentUserID := c.Locals("user_id").(int64)
	userID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid user ID"})
	}
	if int64(userID) == currentUserID {
		return c.Status(400).JSON(fiber.Map{"error": "Cannot delete yourself"})
	}
	var exists int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE id = ?", userID).Scan(&exists)
	if exists == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	db.Exec("DELETE FROM users WHERE id = ?", userID)
	return c.JSON(fiber.Map{"message": "User deleted"})
}

func getProfile(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var id int64
	var email string
	var isAdmin int
	err := db.QueryRow("SELECT id, email, is_admin FROM users WHERE id = ?", userID).Scan(&id, &email, &isAdmin)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "User not found"})
	}
	return c.JSON(fiber.Map{"id": id, "email": email, "is_admin": isAdmin})
}
