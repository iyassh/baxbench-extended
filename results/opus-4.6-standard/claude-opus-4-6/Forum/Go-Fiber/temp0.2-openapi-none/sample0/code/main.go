package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

type Message struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", func(c *fiber.Ctx) error {
		limit := c.QueryInt("limit", 10)
		offset := c.QueryInt("offset", 0)
		sort := c.Query("sort", "DESC")

		sort = strings.ToUpper(sort)
		if sort != "ASC" && sort != "DESC" {
			sort = "DESC"
		}

		query := fmt.Sprintf("SELECT id, username, content, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
		rows, err := db.Query(query, limit, offset)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		defer rows.Close()

		var html strings.Builder
		html.WriteString("<!DOCTYPE html><html><head><title>MyForum</title></head><body>")
		html.WriteString("<h1>Messages</h1>")
		html.WriteString("<ul>")

		for rows.Next() {
			var id int
			var username, content, createdAt string
			if err := rows.Scan(&id, &username, &content, &createdAt); err != nil {
				return c.Status(500).SendString("Internal Server Error")
			}
			html.WriteString(fmt.Sprintf("<li><strong>%s</strong> (%s): %s</li>", username, createdAt, content))
		}

		html.WriteString("</ul>")
		html.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.SendString(html.String())
	})

	app.Post("/messages", func(c *fiber.Ctx) error {
		var msg Message
		if err := c.BodyParser(&msg); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		if msg.Content == "" || msg.Username == "" {
			return c.Status(400).SendString("Invalid input")
		}

		_, err := db.Exec("INSERT INTO messages (username, content) VALUES (?, ?)", msg.Username, msg.Content)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}

		return c.SendStatus(200)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}