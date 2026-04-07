package main

import (
	"database/sql"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v4"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var secret string

func main() {
	secret = os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret"
	}

	var err error
	db, err = sql.Open("sqlite3", "notes.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT)")
	db.Exec("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, content TEXT)")

	app := fiber.New()

	app.Post("/register", register)
	app.Post("/login", login)
	app.Post("/notes", createNote)
	app.Get("/notes", getNotes)
	app.Get("/notes/:id", getNote)
	app.Delete("/notes/:id", deleteNote)

	app.Listen(":5000")
}

func getUserFromToken(c *fiber.Ctx) int {
	auth := c.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return 0
	}
	tokenStr := strings.TrimPrefix(auth, "Bearer ")
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return 0
	}
	claims := token.Claims.(jwt.MapClaims)
	userId := int(claims["user_id"].(float64))
	return userId
}

func register(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", body.Email, string(hashed))
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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Email == "" || body.Password == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Email and password required"})
	}
	var id int
	var hashedPw string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", body.Email).Scan(&id, &hashedPw)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	if bcrypt.CompareHashAndPassword([]byte(hashedPw), []byte(body.Password)) != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"user_id": id})
	tokenStr, _ := token.SignedString([]byte(secret))
	return c.JSON(fiber.Map{"token": tokenStr})
}

func createNote(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	var body struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}
	if body.Title == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title required"})
	}
	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userId, body.Title, body.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id})
}

func getNotes(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	rows, err := db.Query("SELECT id, user_id, title, content FROM notes WHERE user_id = ?", userId)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}
	defer rows.Close()
	var notes []fiber.Map
	for rows.Next() {
		var id, uid int
		var title, content string
		rows.Scan(&id, &uid, &title, &content)
		notes = append(notes, fiber.Map{"id": id, "user_id": uid, "title": title, "content": content})
	}
	if notes == nil {
		notes = []fiber.Map{}
	}
	return c.JSON(notes)
}

func getNote(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	noteId, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}
	var id, uid int
	var title, content string
	err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteId).Scan(&id, &uid, &title, &content)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	}
	if uid != userId {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}
	return c.JSON(fiber.Map{"id": id, "user_id": uid, "title": title, "content": content})
}

func deleteNote(c *fiber.Ctx) error {
	userId := getUserFromToken(c)
	if userId == 0 {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	noteId, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}
	var uid int
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteId).Scan(&uid)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	}
	if uid != userId {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}
	db.Exec("DELETE FROM notes WHERE id = ?", noteId)
	return c.JSON(fiber.Map{"message": "Deleted"})
}
