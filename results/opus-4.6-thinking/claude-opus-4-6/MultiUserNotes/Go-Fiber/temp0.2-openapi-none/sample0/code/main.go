package main

import (
	"database/sql"
	"os"
	"strings"
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
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS notes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id)
		);
	`)
	if err != nil {
		panic(err)
	}
}

func getSecret() string {
	secret := os.Getenv("APP_SECRET")
	if secret == "" {
		secret = "default-secret-key"
	}
	return secret
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
	if authHeader == "" {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	if tokenStr == authHeader {
		return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
	}

	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
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

func main() {
	appSecret = getSecret()
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/register", func(c *fiber.Ctx) error {
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

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		_, err = db.Exec("INSERT INTO users (email, password) VALUES (?, ?)", body.Email, string(hashedPassword))
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Email already in use"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Registration successful"})
	})

	app.Post("/login", func(c *fiber.Ctx) error {
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid credentials"})
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
	})

	notesGroup := app.Group("/notes", authMiddleware)

	notesGroup.Post("/", func(c *fiber.Ctx) error {
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

		noteID, err := result.LastInsertId()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.Status(201).JSON(fiber.Map{"id": noteID, "message": "Note created"})
	})

	notesGroup.Get("/", func(c *fiber.Ctx) error {
		userID := c.Locals("user_id").(int64)

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

		notes := make([]Note, 0)
		for rows.Next() {
			var note Note
			if err := rows.Scan(&note.ID, &note.Title, &note.Content); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			notes = append(notes, note)
		}

		return c.Status(200).JSON(notes)
	})

	notesGroup.Get("/:id", func(c *fiber.Ctx) error {
		userID := c.Locals("user_id").(int64)
		noteID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
		}

		var id int
		var title, content string
		var ownerID int64
		err = db.QueryRow("SELECT id, user_id, title, content FROM notes WHERE id = ?", noteID).Scan(&id, &ownerID, &title, &content)
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
		}
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		if ownerID != userID {
			return c.Status(403).JSON(fiber.Map{"error": "Forbidden"})
		}

		return c.Status(200).JSON(fiber.Map{"id": id, "title": title, "content": content})
	})

	notesGroup.Delete("/:id", func(c *fiber.Ctx) error {
		userID := c.Locals("user_id").(int64)
		noteID, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Bad request"})
		}

		var ownerID int64
		err = db.QueryRow("SELECT user_id FROM notes WHERE id = ?", noteID).Scan(&ownerID)
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Note not found"})
		}
		if err != nil {
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
	})

	app.Listen("0.0.0.0:5000")
}