package main

import (
	"database/sql"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

// User model
type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Note model
type Note struct {
	ID      int    `json:"id"`
	UserID  int    `json:"user_id"`
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

type LoginResponse struct {
	Token string `json:"token"`
}

type CreateNoteResponse struct {
	ID      int    `json:"id"`
	Message string `json:"message"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

// JWT Claims
type Claims struct {
	UserID int `json:"user_id"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func main() {
	// Get JWT secret from environment
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	jwtSecret = []byte(secret)

	// Initialize database
	initDB()
	defer db.Close()

	// Create Fiber app
	app := fiber.New()

	// Routes
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)
	
	// Protected routes
	app.Post("/notes", jwtMiddleware, createNoteHandler)
	app.Get("/notes", jwtMiddleware, getNotesHandler)
	app.Get("/notes/:id", jwtMiddleware, getNoteHandler)
	app.Delete("/notes/:id", jwtMiddleware, deleteNoteHandler)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	// Create users table
	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	)`
	
	if _, err = db.Exec(createUsersTable); err != nil {
		log.Fatal("Failed to create users table:", err)
	}

	// Create notes table
	createNotesTable := `
	CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users (id)
	)`
	
	if _, err = db.Exec(createNotesTable); err != nil {
		log.Fatal("Failed to create notes table:", err)
	}
}

func generateToken(userID int) (string, error) {
	claims := &Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func jwtMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tokenString := ""
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenString = authHeader[7:]
	} else {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	// Store user ID in context
	c.Locals("userID", claims.UserID)
	return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Check if user already exists
	var existingUser User
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUser.ID)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
	} else if err != sql.ErrNoRows {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, string(hashedPassword))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(MessageResponse{Message: "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Get user from database
	var user User
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Check password
	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Generate JWT token
	token, err := generateToken(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(LoginResponse{Token: token})
}

func createNoteHandler(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	
	var req CreateNoteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Insert note
	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, req.Title, req.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(CreateNoteResponse{
		ID:      int(id),
		Message: "Note created",
	})
}

func getNotesHandler(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var notes []fiber.Map
	for rows.Next() {
		var id int
		var title, content string
		err := rows.Scan(&id, &title, &content)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		notes = append(notes, fiber.Map{
			"id":      id,
			"title":   title,
			"content": content,
		})
	}

	// Return empty array if no notes
	if notes == nil {
		notes = []fiber.Map{}
	}

	return c.JSON(notes)
}

func getNoteHandler(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	
	noteIDStr := c.Params("id")
	noteID, err := strconv.Atoi(noteIDStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	var note Note
	err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&note.ID, &note.UserID, &note.Title, &note.Content)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Check if user owns the note
	if note.UserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	return c.JSON(fiber.Map{
		"id":      note.ID,
		"title":   note.Title,
		"content": note.Content,
	})
}

func deleteNoteHandler(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	
	noteIDStr := c.Params("id")
	noteID, err := strconv.Atoi(noteIDStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	// Check if note exists and belongs to user
	var noteUserID int
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&noteUserID)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if noteUserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	// Delete note
	_, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Note deleted"})
}