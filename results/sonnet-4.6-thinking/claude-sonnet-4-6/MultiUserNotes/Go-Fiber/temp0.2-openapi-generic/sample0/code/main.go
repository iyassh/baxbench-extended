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
var jwtSecret []byte

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createUsers := `CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL
	);`

	createNotes := `CREATE TABLE IF NOT EXISTS notes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		FOREIGN KEY(user_id) REFERENCES users(id)
	);`

	if _, err = db.Exec(createUsers); err != nil {
		log.Fatal(err)
	}
	if _, err = db.Exec(createNotes); err != nil {
		log.Fatal(err)
	}
}

func main() {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default_secret_change_me"
	}
	jwtSecret = []byte(secret)

	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", registerHandler)
	app.Post("/login", loginHandler)

	notes := app.Group("/notes", authMiddleware)
	notes.Post("/", createNoteHandler)
	notes.Get("/", listNotesHandler)
	notes.Get("/:id", getNoteHandler)
	notes.Delete("/:id", deleteNoteHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func registerHandler(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
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
		return c.Status(400).JSON(fiber.Map{"error": "Email already in use or invalid"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
}

func loginHandler(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	var userID int
	var hashedPassword string
	err := db.QueryRow("SELECT id, password FROM users WHERE email = ?", body.Email).Scan(&userID, &hashedPassword)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(body.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
	}

	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"token": tokenString})
}

func authMiddleware(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if len(authHeader) < 8 || authHeader[:7] != "Bearer " {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}
	tokenString := authHeader[7:]

	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return jwtSecret, nil
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

	c.Locals("user_id", int(userIDFloat))
	return c.Next()
}

func createNoteHandler(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)

	var body struct {
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}
	if body.Title == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Title is required"})
	}

	result, err := db.Exec("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)", userID, body.Title, body.Content)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	id, _ := result.LastInsertId()
	return c.Status(201).JSON(fiber.Map{"id": id, "message": "Note created"})
}

func listNotesHandler(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)

	rows, err := db.Query("SELECT id, title, content FROM notes WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	type Note struct {
		ID      int    `json:"id"`
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

func getNoteHandler(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	var ownerID int
	var title, content string
	err = db.QueryRow("SELECT user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&ownerID, &title, &content)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if ownerID != userID {
		return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
	}

	return c.Status(200).JSON(fiber.Map{"id": noteID, "title": title, "content": content})
}

func deleteNoteHandler(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)
	noteID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid note ID"})
	}

	var ownerID int
	err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&ownerID)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
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