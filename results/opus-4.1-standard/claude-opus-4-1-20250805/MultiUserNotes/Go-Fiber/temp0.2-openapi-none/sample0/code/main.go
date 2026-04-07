package main

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "notes.db?_journal_mode=WAL")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	)`)
	db.Exec(`CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id)
	)`)

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/notes", requireAuth, createNote)
	app.Get("/notes", requireAuth, listNotes)
	app.Get("/notes/:id", requireAuth, getNote)
	app.Delete("/notes/:id", requireAuth, deleteNote)

	log.Fatal(app.Listen(":5000"))
}

func hashPassword(password string) string {
	h := sha256.Sum256([]byte(password))
	return fmt.Sprintf("%x", h)
}

func requireAuth(c *fiber.Ctx) error {
	auth := c.Get("Authorization")
	if len(auth) < 8 || auth[:7] != "Bearer " {
		return c.Status(401).JSON(fiber.Map{"error": "Missing token"})
	}
	tokenStr := auth[7:]
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
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
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	hashed := hashPassword(body.Password)
	_, err := db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", body.Email, hashed)
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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	hashed := hashPassword(body.Password)
	var id int64
	err := db.QueryRow("SELECT id FROM users WHERE email = ? AND password = ?", body.Email, hashed).Scan(&id)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"user_id": id})
	tokenStr, _ := token.SignedString([]byte(appSecret))
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
	if body.Title == "" || body.Content == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title and content required"})
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
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
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
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	}
	if noteUserID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}
	db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	return c.JSON(fiber.Map{"message": "Note deleted"})
}
