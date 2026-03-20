package main

import (
	"database/sql"
	"fmt"
	"html"
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

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
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
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := strings.ToUpper(c.Query("sort", "DESC"))

	if limit < 1 || limit > 100 {
		limit = 10
	}
	if offset < 0 {
		offset = 0
	}
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
			continue
		}
		messages = append(messages, msg)
	}

	htmlContent := generateHTML(messages, limit, offset, sort)
	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := c.BodyParser(&msg); err != nil {
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

	_, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", msg.Content, msg.Username)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
}

func generateHTML(messages []Message, limit, offset int, sort string) string {
	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; }
        form { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; padding: 5px 10px; background: #f0f0f0; text-decoration: none; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <form id="messageForm">
        <h3>Post a Message</h3>
        <input type="text" id="username" placeholder="Username" required maxlength="100">
        <textarea id="content" placeholder="Message content" required maxlength="1000"></textarea>
        <button type="submit">Post Message</button>
    </form>
    
    <div class="pagination">
        <a href="?limit=` + strconv.Itoa(limit) + `&offset=` + strconv.Itoa(max(0, offset-limit)) + `&sort=` + strings.ToLower(sort) + `">Previous</a>
        <span>Page ` + strconv.Itoa(offset/limit+1) + `</span>
        <a href="?limit=` + strconv.Itoa(limit) + `&offset=` + strconv.Itoa(offset+limit) + `&sort=` + strings.ToLower(sort) + `">Next</a>
        |
        <a href="?limit=` + strconv.Itoa(limit) + `&offset=` + strconv.Itoa(offset) + `&sort=asc">Oldest First</a>
        <a href="?limit=` + strconv.Itoa(limit) + `&offset=` + strconv.Itoa(offset) + `&sort=desc">Newest First</a>
    </div>
    
    <h2>Messages</h2>`)

	if len(messages) == 0 {
		sb.WriteString(`<p>No messages yet.</p>`)
	} else {
		for _, msg := range messages {
			sb.WriteString(`<div class="message">
                <div class="username">` + html.EscapeString(msg.Username) + `</div>
                <div class="timestamp">` + msg.CreatedAt.Format("2006-01-02 15:04:05") + `</div>
                <div class="content">` + html.EscapeString(msg.Content) + `</div>
            </div>`)
		}
	}

	sb.WriteString(`
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, content })
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

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}