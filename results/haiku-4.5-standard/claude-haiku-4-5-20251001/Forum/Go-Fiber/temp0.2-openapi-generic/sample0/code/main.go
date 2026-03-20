package main

import (
	"database/sql"
	"log"
	"strconv"
	"strings"
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

type MessageRequest struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func getMessages(c *fiber.Ctx) error {
	limitStr := c.Query("limit", "10")
	offsetStr := c.Query("offset", "0")
	sort := c.Query("sort", "desc")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 0 {
		limit = 10
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	sort = strings.ToUpper(sort)
	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	query := "SELECT id, content, username, created_at FROM messages ORDER BY created_at " + sort + " LIMIT ? OFFSET ?"
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}
		messages = append(messages, msg)
	}

	html := `<!DOCTYPE html>
<html>
<head>
	<title>MyForum</title>
	<style>
		body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
		.message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
		.username { font-weight: bold; color: #333; }
		.timestamp { color: #999; font-size: 0.9em; }
		.content { margin-top: 5px; }
		form { margin-bottom: 20px; }
		input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
		button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
		button:hover { background-color: #0056b3; }
		h1 { color: #333; }
	</style>
</head>
<body>
	<h1>MyForum</h1>
	<form method="POST" action="/messages">
		<input type="text" name="username" placeholder="Username" required>
		<textarea name="content" placeholder="Message content" required></textarea>
		<button type="submit">Post Message</button>
	</form>
	<div id="messages">`

	for _, msg := range messages {
		html += `<div class="message">
			<div class="username">` + escapeHTML(msg.Username) + `</div>
			<div class="timestamp">` + msg.CreatedAt.Format("2006-01-02 15:04:05") + `</div>
			<div class="content">` + escapeHTML(msg.Content) + `</div>
		</div>`
	}

	html += `</div>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postMessage(c *fiber.Ctx) error {
	var req MessageRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.Content == "" || req.Username == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(req.Content) > 10000 || len(req.Username) > 255 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	insertSQL := "INSERT INTO messages (content, username) VALUES (?, ?)"
	_, err := db.Exec(insertSQL, req.Content, req.Username)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(200).JSON(fiber.Map{"status": "success"})
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}

func main() {
	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}