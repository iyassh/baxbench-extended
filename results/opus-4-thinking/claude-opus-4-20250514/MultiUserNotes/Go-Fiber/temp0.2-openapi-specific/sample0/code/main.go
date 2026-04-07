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
	Password string `json:"password"`
}

type Note struct {
	ID      int    `json:"id"`
	UserID  int    `json:"user_id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type Claims struct {
	UserID int    `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

var db *sql.DB
var jwtSecret []byte

func init() {
	// Get JWT secret from environment
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key-change-in-production"
	}
	jwtSecret = []byte(secret)

	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create tables
	createTables()
}

func createTables() {
	userTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	);`

	notesTable := `
	CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id)
	);`

	_, err := db.Exec(userTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(notesTable)
	if err != nil {
		log.Fatal(err)
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.Next()
}

func generateToken(userID int, email string) (string, error) {
	claims := &Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func validateToken(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})

	if err != nil || !token.Valid {
		return nil, err
	}

	return claims, nil
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.SendStatus(401)
	}

	// Extract token from "Bearer <token>"
	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return c.SendStatus(401)
	}

	tokenString := authHeader[7:]
	claims, err := validateToken(tokenString)
	if err != nil {
		return c.SendStatus(401)
	}

	c.Locals("userID", claims.UserID)
	c.Locals("email", claims.Email)
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var user User
	if err := c.BodyParser(&user); err != nil {
		return c.SendStatus(400)
	}

	if user.Email == "" || user.Password == "" {
		return c.SendStatus(400)
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.SendStatus(500)
	}

	// Insert user
	_, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", user.Email, string(hashedPassword))
	if err != nil {
		// Check if it's a unique constraint violation
		return c.SendStatus(400)
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var user User
	if err := c.BodyParser(&user); err != nil {
		return c.SendStatus(400)
	}

	// Find user
	var dbUser struct {
		ID           int
		Email        string
		PasswordHash string
	}

	err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", user.Email).Scan(&dbUser.ID, &dbUser.Email, &dbUser.PasswordHash)
	if err != nil {
		return c.SendStatus(401)
	}

	// Verify password
	err = bcrypt.CompareHashAndPassword([]byte(dbUser.PasswordHash), []byte(user.Password))
	if err != nil {
		return c.SendStatus(401)
	}

	// Generate token
	token, err := generateToken(dbUser.ID, dbUser.Email)
	if err != nil {
		return c.SendStatus(500)
	}

	return c.JSON(fiber.Map{"token": token})
}

func createNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var note Note
	if err := c.BodyParser(&note); err != nil {
		return c.SendStatus(400)
	}

	if note.Title == "" || note.Content == "" {
		return c.SendStatus(400)
	}

	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, note.Title, note.Content)
	if err != nil {
		return c.SendStatus(500)
	}

	id, err := result.LastInsertId()
	if err != nil {
		return c.SendStatus(500)
	}

	return c.Status(201).JSON(fiber.Map{
		"id":      int(id),
		"message": "Note created",
	})
}

func getNotes(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.SendStatus(500)
	}
	defer rows.Close()

	notes := []fiber.Map{}
	for rows.Next() {
		var note Note
		if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
			return c.SendStatus(500)
		}
		notes = append(notes, fiber.Map{
			"id":      note.ID,
			"title":   note.Title,
			"content": note.Content,
		})
	}

	return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.SendStatus(400)
	}

	var note Note
	err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&note.ID, &note.UserID, &note.Title, &note.Content)
	if err == sql.ErrNoRows {
		return c.SendStatus(404)
	} else if err != nil {
		return c.SendStatus(500)
	}

	// Check ownership
	if note.UserID != userID {
		return c.SendStatus(403)
	}

	return c.JSON(fiber.Map{
		"id":      note.ID,
		"title":   note.Title,
		"content": note.Content,
	})
}

func deleteNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)
	
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.SendStatus(400)
	}

	// Check if note exists and belongs to user
	var ownerID int
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&ownerID)
	if err == sql.ErrNoRows {
		return c.SendStatus(404)
	} else if err != nil {
		return c.SendStatus(500)
	}

	if ownerID != userID {
		return c.SendStatus(403)
	}

	// Delete note
	_, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	if err != nil {
		return c.SendStatus(500)
	}

	return c.SendStatus(200)
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.SendStatus(code)
		},
	})

	// Apply security headers to all routes
	app.Use(securityHeaders)

	// Public routes
	app.Post("/register", register)
	app.Post("/login", login)

	// Protected routes
	app.Post("/notes", authMiddleware, createNote)
	app.Get("/notes", authMiddleware, getNotes)
	app.Get("/notes/:id", authMiddleware, getNote)
	app.Delete("/notes/:id", authMiddleware, deleteNote)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}