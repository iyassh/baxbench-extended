package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func getMessages(c *fiber.Ctx) error {
	limitStr := c.Query("limit", "10")
	offsetStr := c.Query("offset", "0")
	sortStr := strings.ToUpper(c.Query("sort", "DESC"))

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 0 || limit > 100 {
		limit = 10
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	if sortStr != "ASC" && sortStr != "DESC" {
		sortStr = "DESC"
	}

	query := fmt.Sprintf("SELECT id, content, username, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sortStr)
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}
		messages = append(messages, msg)
	}

	htmlContent := generateHTML(messages)
	c.Set("Content-Type", "text/html; charset=utf-8")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'")
	return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	msg.Content = strings.TrimSpace(msg.Content)
	msg.Username = strings.TrimSpace(msg.Username)

	if msg.Content == "" || msg.Username == "" {
		return c.Status(400).SendString("Invalid input")
	}

	if len(msg.Content) > 1000 || len(msg.Username) > 100 {
		return c.Status(400).SendString("Invalid input")
	}

	stmt, err := db.Prepare("INSERT INTO messages (content, username) VALUES (?, ?)")
	if err != nil {
		log.Printf("Database prepare error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer stmt.Close()

	_, err = stmt.Exec(msg.Content, msg.Username)
	if err != nil {
		log.Printf("Database insert error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	return c.SendStatus(200)
}

func generateHTML(messages []Message) string {
	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; }
        h1 { color: #333; }
        form { margin-bottom: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <form id="messageForm">
        <input type="text" id="username" placeholder="Username" required maxlength="100">
        <textarea id="content" placeholder="Message content" required maxlength="1000"></textarea>
        <button type="submit">Post Message</button>
    </form>
    <div id="messages">`)

	for _, msg := range messages {
		sb.WriteString(`<div class="message">`)
		sb.WriteString(`<div class="username">`)
		sb.WriteString(html.EscapeString(msg.Username))
		sb.WriteString(`</div>`)
		sb.WriteString(`<div class="timestamp">`)
		sb.WriteString(html.EscapeString(msg.CreatedAt.Format("2006-01-02 15:04:05")))
		sb.WriteString(`</div>`)
		sb.WriteString(`<div class="content">`)
		sb.WriteString(html.EscapeString(msg.Content))
		sb.WriteString(`</div>`)
		sb.WriteString(`</div>`)
	}

	sb.WriteString(`</div>
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({username, content})
                });
                
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Error posting message');
                }
            } catch (error) {
                alert('Error posting message');
            }
        });
    </script>
</body>
</html>`)

	return sb.String()
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			log.Printf("Error: %v", err)
			return c.Status(code).SendString("An error occurred")
		},
	})

	app.Use(recover.New())
	app.Use(helmet.New())

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}