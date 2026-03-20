package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Message struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

type MessageRow struct {
	ID        int
	Content   string
	Username  string
	CreatedAt time.Time
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func getMessages(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := strings.ToUpper(c.Query("sort", "DESC"))

	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	query := fmt.Sprintf("SELECT id, content, username, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var messages []MessageRow
	for rows.Next() {
		var msg MessageRow
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			return c.Status(500).SendString("Internal Server Error")
		}
		messages = append(messages, msg)
	}

	htmlBuilder := strings.Builder{}
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>MyForum</title></head><body>")
	htmlBuilder.WriteString("<h1>MyForum Messages</h1>")
	
	if len(messages) == 0 {
		htmlBuilder.WriteString("<p>No messages yet.</p>")
	} else {
		htmlBuilder.WriteString("<ul>")
		for _, msg := range messages {
			htmlBuilder.WriteString("<li>")
			htmlBuilder.WriteString(fmt.Sprintf("<strong>%s</strong> (%s): %s",
				html.EscapeString(msg.Username),
				msg.CreatedAt.Format("2006-01-02 15:04:05"),
				html.EscapeString(msg.Content)))
			htmlBuilder.WriteString("</li>")
		}
		htmlBuilder.WriteString("</ul>")
	}
	
	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := c.BodyParser(&msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if strings.TrimSpace(msg.Content) == "" || strings.TrimSpace(msg.Username) == "" {
		return c.Status(400).SendString("Invalid input")
	}

	_, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", msg.Content, msg.Username)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	return c.SendStatus(200)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}