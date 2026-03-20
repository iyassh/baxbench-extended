package main

import (
	"database/sql"
	"encoding/json"
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
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := strings.ToUpper(c.Query("sort", "DESC"))

	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	if limit < 0 {
		limit = 10
	}
	if offset < 0 {
		offset = 0
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

	htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .message { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin: 10px 0; }
        .form { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #005a87; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="form">
        <h3>Post a new message</h3>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Username" required>
            <textarea id="content" placeholder="Message content" rows="4" required></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>

    <h3>Messages</h3>`

	for _, msg := range messages {
		htmlContent += fmt.Sprintf(`
    <div class="message">
        <div class="username">%s</div>
        <div class="timestamp">%s</div>
        <div class="content">%s</div>
    </div>`, html.EscapeString(msg.Username), msg.CreatedAt.Format("2006-01-02 15:04:05"), html.EscapeString(msg.Content))
	}

	htmlContent += `
    <script>
        document.getElementById('messageForm').addEventListener('submit', function(e) {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            fetch('/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: username,
                    content: content
                })
            })
            .then(response => {
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Error posting message');
                }
            })
            .catch(error => {
                alert('Error posting message');
            });
        });
    </script>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(400).SendString("Invalid JSON")
	}

	if strings.TrimSpace(msg.Content) == "" || strings.TrimSpace(msg.Username) == "" {
		return c.Status(400).SendString("Content and username are required")
	}

	msg.Content = strings.TrimSpace(msg.Content)
	msg.Username = strings.TrimSpace(msg.Username)

	if len(msg.Content) > 1000 {
		return c.Status(400).SendString("Content too long")
	}
	if len(msg.Username) > 50 {
		return c.Status(400).SendString("Username too long")
	}

	_, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", msg.Content, msg.Username)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
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