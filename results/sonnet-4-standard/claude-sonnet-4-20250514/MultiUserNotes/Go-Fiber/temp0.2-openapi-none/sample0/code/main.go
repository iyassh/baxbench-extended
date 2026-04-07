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

type User struct {
	ID       int    `json:"id"`
	Email    string `json:"email"`
	Password string `json:"-"`
}

type Note struct {
	ID      int    `json:"id"`
	UserID  int    `json:"user_id,omitempty"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

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

type Claims struct {
	UserID int `json:"user_id"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func main() {
	// Get JWT secret from environment
	jwtSecret = []byte(os.Getenv("APP_SECRET"))
	if len(jwtSecret) == 0 {
		jwtSecret = []byte("default-secret-key")
	}

	// Initialize database
	initDB()
	defer db.Close()

	app := fiber.New()

	// Routes
	app.Post("/register", register)
	app.Post("/login", login)
	
	// Protected routes
	app.Post("/notes", authMiddleware, createNote)
	app.Get("/notes", authMiddleware, listNotes)
	app.Get("/notes/:id", authMiddleware, getNote)
	app.Delete("/notes/:id", authMiddleware, deleteNote)

	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create users table
	createUsersTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`
	
	_, err = db.Exec(createUsersTable)
	if err != nil {
		log.Fatal(err)
	}

	// Create notes table
	createNotesTable := `
	CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users (id)
	);`
	
	_, err = db.Exec(createNotesTable)
	if err != nil {
		log.Fatal(err)
	}
}

func register(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Check if user exists
	var existingID int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingID)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, string(hashedPassword))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create user"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Get user from database
	var user User
	err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &user.Password)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Check password
	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Generate JWT token
	claims := Claims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
	}

	return c.JSON(fiber.Map{"token": tokenString})
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Authorization header required"})
	}

	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid authorization format"})
	}

	tokenString := authHeader[7:]

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
	}

	// Store user ID in context
	c.Locals("userID", claims.UserID)
	return c.Next()
}

func createNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var req CreateNoteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, req.Title, req.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create note"})
	}

	noteID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to get note ID"})
	}

	return c.Status(201).JSON(fiber.Map{
		"id":      noteID,
		"message": "Note created",
	})
}

func listNotes(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch notes"})
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var note Note
		err := rows.Scan(&note.ID, &note.Title, &note.Content)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to scan note"})
		}
		notes = append(notes, note)
	}

	if notes == nil {
		notes = []Note{}
	}

	return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	var note Note
	var ownerID int
	err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&note.ID, &ownerID, &note.Title, &note.Content)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	if ownerID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	return c.JSON(note)
}

func deleteNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	// Check if note exists and belongs to user
	var ownerID int
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&ownerID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	if ownerID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	// Delete the note
	_, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete note"})
	}

	return c.JSON(fiber.Map{"message": "Note deleted"})
}