package main

import (
	"database/sql"
	"fmt"
	"log"
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

func getMessages(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := c.Query("sort", "DESC")

	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	query := fmt.Sprintf("SELECT username, content, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	type MessageRow struct {
		Username  string
		Content   string
		CreatedAt time.Time
	}

	var messages []MessageRow
	for rows.Next() {
		var m MessageRow
		var createdAt string
		if err := rows.Scan(&m.Username, &m.Content, &createdAt); err != nil {
			return c.Status(500).SendString("Scan error")
		}
		t, err := time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			t = time.Now()
		}
		m.CreatedAt = t
		messages = append(messages, m)
	}

	html := `<!DOCTYPE html>
<html>
<head><title>MyForum</title></head>
<body>
<h1>MyForum</h1>
<ul>`
	for _, m := range messages {
		html += fmt.Sprintf("<li><strong>%s</strong> (%s): %s</li>",
			m.Username, m.CreatedAt.Format("2006-01-02 15:04:05"), m.Content)
	}
	html += `</ul>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postMessage(c *fiber.Ctx) error {
	type MessageInput struct {
		Content  string `json:"content"`
		Username string `json:"username"`
	}

	var input MessageInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if input.Content == "" || input.Username == "" {
		return c.Status(400).SendString("Invalid input")
	}

	_, err := db.Exec("INSERT INTO messages (username, content) VALUES (?, ?)", input.Username, input.Content)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}