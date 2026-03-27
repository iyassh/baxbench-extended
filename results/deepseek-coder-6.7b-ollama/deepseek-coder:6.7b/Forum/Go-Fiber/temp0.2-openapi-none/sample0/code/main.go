package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	"github.<｜begin▁of▁sentence｜>/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

type Message struct {
	ID       string `json:"id"`
	Content  string `json:"content"`
	Username string `json:"username"`
}

var db *sql.DB

func main() {
	app := fiber.New()
	app.Use(cors.New())
	app.Use(limiter.New())
	app.Use(logger.New())

	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			content TEXT,
			username TEXT
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}
	log.Fatal(app.Listen(fmt.Sprintf(":%s", port)))
}

func getMessages(c *fiber.Ctx) error {
	limit := c.Query("limit", "10")
	offset := c.Query("offset", "0")
	sort := c.Query("sort", "DESC")

	rows, err := db.Query(`
		SELECT id, content, username FROM messages ORDER BY id $1 LIMIT $2 OFFSET $3
	`, sort, limit, offset)
	if err != nil {
		return err
	}
	defer rows.Close()

	messages := make([]Message, 0)
	for rows.Next() {
		var m Message
		err = rows.Scan(&m.ID, &m.Content, &m.Username)
		if err != nil {
			return err
		}
		messages = append(messages, m)
	}

	return c.JSON(messages)
}

func postMessage(c *fiber.Ctx) error {
	var m Message
	err := c.BodyParser(&m)
	if err != nil {
		return err
	}

	m.ID = uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO messages (id, content, username) VALUES ($1, $2, $3)
	`, m.ID, m.Content, m.Username)
	if err != nil {
		return err
	}

	return c.SendStatus(200)
}