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

		filtered := make([]time.Time, 0, len(entry.timestamps))
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
	db, err = sql.Open("sqlite3", "notes.db?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		csrf_token TEXT
	)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
	app.Post("/notes", requireAuth, createNote)
	app.Get("/notes", requireAuth, listNotes)
	app.Get("/notes/:id", requireAuth, getNote)
	app.Delete("/notes/:id", requireAuth, deleteNote)

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
	c.Locals("user_id", userID)
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
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", body.Email, string(hashed))
	if err != nil {
		return c.Status(409).JSON(fiber.Map{"error": "Email already registered"})
	}
	return c.Status(201).JSON(fiber.Map{"message": "User registered successfully"})
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
		Name:     "session_token",
		Value:    tokenStr,
		HTTPOnly: true,
		Secure:   true,
		SameSite: "Strict",
		MaxAge:   3600,
	})
	return c.JSON(fiber.Map{"token": tokenStr})
}

func createNote(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	var body struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	body.Title = strings.TrimSpace(body.Title)
	body.Content = strings.TrimSpace(body.Content)
	if body.Title == "" || body.Content == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title and content are required"})
	}
	if len(body.Title) > 500 {
		return c.Status(400).JSON(fiber.Map{"error": "Title too long"})
	}
	if len(body.Content) > 50000 {
		return c.Status(400).JSON(fiber.Map{"error": "Content too long"})
	}
	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, body.Title, body.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create note"})
	}
	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id})
}

func listNotes(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch notes"})
	}
	defer rows.Close()
	notes := []fiber.Map{}
	for rows.Next() {
		var id int64
		var title, content string
		rows.Scan(&id, &title, &content)
		notes = append(notes, fiber.Map{"id": id, "title": title, "content": content})
	}
	return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	noteID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}
	var id int64
	var noteUserID int64
	var title, content string
	err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&id, &noteUserID, &title, &content)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}
	if noteUserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}
	return c.JSON(fiber.Map{"id": id, "title": title, "content": content})
}

func deleteNote(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	noteID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}
	var noteUserID int64
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&noteUserID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}
	if noteUserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}
	db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	return c.JSON(fiber.Map{"message": "Note deleted"})
}
