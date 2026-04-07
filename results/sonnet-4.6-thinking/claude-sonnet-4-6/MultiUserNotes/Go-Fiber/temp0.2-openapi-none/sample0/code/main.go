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
var appSecret string

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY(user_id) REFERENCES users(id)
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func generateToken(userID int64) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(appSecret))
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	tokenStr := authHeader[7:]

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(appSecret), nil
	})
	if err != nil || !token.Valid {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	userIDFloat, ok := claims["user_id"].(float64)
	if !ok {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	c.Locals("user_id", int64(userIDFloat))
	return c.Next()
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password are required"})
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", body.Email, string(hashed))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
	}

	var userID int64
	var hashedPassword string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", body.Email).Scan(&userID, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(body.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	token, err := generateToken(userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"token": token})
}

func createNote(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)

	var body struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
	}

	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, body.Title, body.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id, "message": "Note created"})
}

func listNotes(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	type Note struct {
		ID      int64  `json:"id"`
		Title   string `json:"title"`
		Content string `json:"content"`
	}

	notes := []Note{}
	for rows.Next() {
		var n Note
		if err := rows.Scan(&n.ID, &n.Title, &n.Content); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		notes = append(notes, n)
	}

	return c.Status(200).JSON(notes)
}

func getNote(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	noteID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}

	var ownerID int64
	var title, content string
	err = db.QueryRow("SELECT user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&ownerID, &title, &content)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}

	if ownerID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	return c.Status(200).JSON(fiber.Map{"id": noteID, "title": title, "content": content})
}

func deleteNote(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int64)
	noteID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}

	var ownerID int64
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&ownerID)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	}

	if ownerID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	_, err = db.Exec("DELETE FROM notes WHERE id = ?", noteID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Note deleted"})
}

func main() {
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = "default-secret"
	}

	initDB()

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)

	notes := app.Group("/notes", authMiddleware)
	notes.Post("/", createNote)
	notes.Get("/", listNotes)
	notes.Get("/:id", getNote)
	notes.Delete("/:id", deleteNote)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}