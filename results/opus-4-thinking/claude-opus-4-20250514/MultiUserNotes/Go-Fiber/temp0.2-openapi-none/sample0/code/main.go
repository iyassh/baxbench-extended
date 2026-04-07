package main

import (
	"database/sql"
	"fmt"
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
	Title   string `json:"title"`
	Content string `json:"content"`
	UserID  int    `json:"-"`
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

var db *sql.DB
var jwtSecret []byte

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create users table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create notes table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			user_id INTEGER NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users (id)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func getUserFromToken(c *fiber.Ctx) (*User, error) {
	tokenString := c.Get("Authorization")
	if tokenString == "" {
		return nil, fmt.Errorf("missing authorization header")
	}

	if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
		tokenString = tokenString[7:]
	} else {
		return nil, fmt.Errorf("invalid authorization header format")
	}

	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		userID := int(claims["user_id"].(float64))
		
		var user User
		err := db.QueryRow("SELECT id, email FROM users WHERE id = ?", userID).Scan(&user.ID, &user.Email)
		if err != nil {
			return nil, err
		}
		
		return &user, nil
	}

	return nil, fmt.Errorf("invalid token")
}

func authMiddleware(c *fiber.Ctx) error {
	user, err := getUserFromToken(c)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	
	c.Locals("user", user)
	return c.Next()
}

func registerHandler(c *fiber.Ctx) error {
	var req RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Check if email already exists
	var existingUser int
	err := db.QueryRow("SELECT id FROM users WHERE email = ?", req.Email).Scan(&existingUser)
	if err == nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to hash password"})
	}

	// Insert new user
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", req.Email, string(hashedPassword))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create user"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Get user from database
	var user User
	var hashedPassword string
	err := db.QueryRow("SELECT id, email, password FROM users WHERE email = ?", req.Email).Scan(&user.ID, &user.Email, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	// Generate JWT token
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": user.ID,
		"email":   user.Email,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to generate token"})
	}

	return c.JSON(fiber.Map{"token": tokenString})
}

func createNoteHandler(c *fiber.Ctx) error {
	user := c.Locals("user").(*User)

	var req CreateNoteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	result, err := db.Exec("INSERT INTO notes (title, content, user_id) VALUES (?, ?, ?)", 
		req.Title, req.Content, user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to create note"})
	}

	id, _ := result.LastInsertId()
	
	return c.Status(201).JSON(fiber.Map{
		"id":      int(id),
		"message": "Note created",
	})
}

func listNotesHandler(c *fiber.Ctx) error {
	user := c.Locals("user").(*User)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch notes"})
	}
	defer rows.Close()

	var notes []Note
	for rows.Next() {
		var note Note
		if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
			continue
		}
		notes = append(notes, note)
	}

	if notes == nil {
		notes = []Note{}
	}

	return c.JSON(notes)
}

func getNoteHandler(c *fiber.Ctx) error {
	user := c.Locals("user").(*User)
	
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	var note Note
	var userID int
	err = db.QueryRow("SELECT id, title, content, user_id FROM notes WHERE id = ?", id).
		Scan(&note.ID, &note.Title, &note.Content, &userID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}

	if userID != user.ID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	return c.JSON(note)
}

func deleteNoteHandler(c *fiber.Ctx) error {
	user := c.Locals("user").(*User)
	
	id, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	// Check if note exists and belongs to user
	var userID int
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", id).Scan(&userID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}

	if userID != user.ID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	// Delete the note
	_, err = db.Exec("DELETE FROM notes WHERE id = ?", id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to delete note"})
	}

	return c.SendStatus(200)
}

func main() {
	// Initialize JWT secret
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-for-development"
	}
	jwtSecret = []byte(secret)

	// Initialize database
	initDB()
	defer db.Close()

	// Create fiber app
	app := fiber.New()

	// Public routes
	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)

	// Protected routes
	app.Post("/notes", authMiddleware, createNoteHandler)
	app.Get("/notes", authMiddleware, listNotesHandler)
	app.Get("/notes/:id", authMiddleware, getNoteHandler)
	app.Delete("/notes/:id", authMiddleware, deleteNoteHandler)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}