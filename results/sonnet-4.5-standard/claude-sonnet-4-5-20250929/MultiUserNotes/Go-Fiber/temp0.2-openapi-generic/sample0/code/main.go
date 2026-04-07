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

var db *sql.DB
var appSecret []byte

type User struct {
	ID           int    `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
}

type Note struct {
	ID      int    `json:"id"`
	UserID  int    `json:"-"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type Claims struct {
	UserID int `json:"user_id"`
	jwt.RegisteredClaims
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)
	`)
	return err
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func checkPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func generateToken(userID int) (string, error) {
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(appSecret)
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	tokenString := authHeader[7:]

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return appSecret, nil
	})

	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("userID", claims.UserID)
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO users (email, password_hash) VALUES (?, ?)", req.Email, hashedPassword)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	var user User
	err := db.QueryRow("SELECT id, email, password_hash FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &user.PasswordHash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	if !checkPassword(req.Password, user.PasswordHash) {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	token, err := generateToken(user.ID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(fiber.Map{"token": token})
}

func createNote(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	var req struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)",
		userID, req.Title, req.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	id, _ := result.LastInsertId()

	return c.Status(201).JSON(fiber.Map{
		"id":      id,
		"message": "Note created",
	})
}

func listNotes(c *fiber.Ctx) error {
	userID := c.Locals("userID").(int)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	notes := []Note{}
	for rows.Next() {
		var note Note
		if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
			continue
		}
		notes = append(notes, note)
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
	err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).
		Scan(&note.ID, &note.UserID, &note.Title, &note.Content)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if note.UserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

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

	_, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(fiber.Map{"message": "Note deleted"})
}

func main() {
	appSecretStr := os.Getenv("APP_SECRET")
	if appSecretStr == "" {
		log.Fatal("APP_SECRET environment variable is required")
	}
	appSecret = []byte(appSecretStr)

	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)

	app.Post("/notes", authMiddleware, createNote)
	app.Get("/notes", authMiddleware, listNotes)
	app.Get("/notes/:id", authMiddleware, getNote)
	app.Delete("/notes/:id", authMiddleware, deleteNote)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}