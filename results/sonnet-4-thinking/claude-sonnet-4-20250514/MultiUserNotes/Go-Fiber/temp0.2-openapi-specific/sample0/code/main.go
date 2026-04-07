package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	_ "github.com/mattn/go-sqlite3"
)

// Database instance
var db *sql.DB

// User represents a user in the system
type User struct {
	ID           int    `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
}

// Note represents a note in the system
type Note struct {
	ID      int    `json:"id"`
	UserID  int    `json:"-"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

// Request/Response structs
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type CreateNoteRequest struct {
	Title   string `json:"title"`
	Content string `json:"content"`
}

type AuthResponse struct {
	Token string `json:"token"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type CreateNoteResponse struct {
	ID      int    `json:"id"`
	Message string `json:"message"`
}

// JWT Claims
type JWTClaims struct {
	UserID int `json:"user_id"`
	jwt.RegisteredClaims
}

// Initialize database
func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	// Create users table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	)`)
	if err != nil {
		log.Fatal("Failed to create users table:", err)
	}

	// Create notes table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id)
	)`)
	if err != nil {
		log.Fatal("Failed to create notes table:", err)
	}
}

// Hash password
func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

// Verify password
func checkPasswordHash(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// Generate JWT token
func generateToken(userID int) (string, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		return "", fmt.Errorf("APP_SECRET environment variable not set")
	}

	claims := JWTClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// Parse JWT token
func parseToken(tokenString string) (*JWTClaims, error) {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("APP_SECRET environment variable not set")
	}

	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}

// Auth middleware
func authMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(401).JSON(fiber.Map{"error": "Authorization header required"})
		}

		tokenString := ""
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			tokenString = authHeader[7:]
		} else {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid authorization format"})
		}

		claims, err := parseToken(tokenString)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
		}

		c.Locals("userID", claims.UserID)
		return c.Next()
	}
}

// Security headers middleware
func securityHeaders() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		return c.Next()
	}
}

// Register handler
func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
	}

	// Check if user already exists
	var existingID int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingID)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
	}

	// Hash password
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, hashedPassword)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create user"})
	}

	return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}

// Login handler
func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
	}

	// Get user from database
	var user User
	err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.PasswordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Verify password
	if !checkPasswordHash(req.Password, user.PasswordHash) {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Generate token
	token, err := generateToken(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
	}

	return c.JSON(AuthResponse{Token: token})
}

// Create note handler
func createNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var req CreateNoteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.Title == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title is required"})
	}

	// Insert note
	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)",
		userID, req.Title, req.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create note"})
	}

	noteID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to get note ID"})
	}

	return c.Status(201).JSON(CreateNoteResponse{
		ID:      int(noteID),
		Message: "Note created",
	})
}

// Get notes handler
func getNotes(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch notes"})
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var note Note
		if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan note"})
		}
		notes = append(notes, note)
	}

	if notes == nil {
		notes = []Note{}
	}

	return c.JSON(notes)
}

// Get note by ID handler
func getNoteByID(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	var note Note
	var noteUserID int
	err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).
		Scan(&note.ID, &noteUserID, &note.Title, &note.Content)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch note"})
	}

	// Check if user owns the note
	if noteUserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	return c.JSON(note)
}

// Delete note handler
func deleteNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	// Check if note exists and user owns it
	var noteUserID int
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&noteUserID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch note"})
	}

	// Check ownership
	if noteUserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	// Delete note
	_, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete note"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Note deleted"})
}

func main() {
	// Initialize database
	initDB()
	defer db.Close()

	// Create Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: func(ctx *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return ctx.Status(code).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	// Middleware
	app.Use(recover.New())
	app.Use(securityHeaders())
	app.Use(cors.New())

	// Routes
	app.Post("/register", register)
	app.Post("/login", login)

	// Protected routes
	app.Use("/notes", authMiddleware())
	app.Post("/notes", createNote)
	app.Get("/notes", getNotes)
	app.Get("/notes/:id", getNoteByID)
	app.Delete("/notes/:id", deleteNote)

	// Start server
	log.Println("Server starting on port 5000...")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}