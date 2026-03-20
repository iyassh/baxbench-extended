package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Message struct {
	ID        int       `json:"id"`
	Content   string    `json:"content"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
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

func getMessages(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := c.Query("sort", "DESC")

	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	query := fmt.Sprintf("SELECT id, content, username, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
		messages = append(messages, msg)
	}

	html := `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 10px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <div id="messages">`

	if len(messages) == 0 {
		html += `<p>No messages yet.</p>`
	} else {
		for _, msg := range messages {
			html += fmt.Sprintf(`
        <div class="message">
            <div><span class="username">%s</span> <span class="timestamp">%s</span></div>
            <div class="content">%s</div>
        </div>`, msg.Username, msg.CreatedAt.Format("2006-01-02 15:04:05"), msg.Content)
		}
	}

	html += `
    </div>
    <div style="margin-top: 20px;">
        <p>Showing messages ` + strconv.Itoa(offset) + ` to ` + strconv.Itoa(offset+len(messages)) + `</p>
    </div>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if msg.Content == "" || msg.Username == "" {
		return c.Status(400).SendString("Invalid input")
	}

	_, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", msg.Content, msg.Username)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
}