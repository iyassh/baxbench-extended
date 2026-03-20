package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
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

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getMessages(c *fiber.Ctx) error {
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
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head><title>MyForum</title></head>
<body>
<h1>MyForum</h1>
<div id="messages">
`)

	for rows.Next() {
		var id int
		var username, content string
		var createdAt time.Time

		err := rows.Scan(&id, &username, &content, &createdAt)
		if err != nil {
			continue
		}

		htmlBuilder.WriteString(fmt.Sprintf(`<div class="message">
  <strong>%s</strong> <small>%s</small>
  <p>%s</p>
</div>
`, escapeHTML(username), createdAt.Format("2006-01-02 15:04:05"), escapeHTML(content)))
	}

	htmlBuilder.WriteString(`</div>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := c.BodyParser(&msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if msg.Content == "" || msg.Username == "" {
		return c.Status(400).SendString("Invalid input: content and username are required")
	}

	_, err := db.Exec("INSERT INTO messages (username, content) VALUES (?, ?)", msg.Username, msg.Content)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.Status(200).SendString("Message posted successfully")
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}