package main

import (
	"database/sql"
	"fmt"
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

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
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

	html := `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; }
        form { margin: 20px 0; padding: 20px; background: #f5f5f5; border-radius: 5px; }
        input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <form id="messageForm">
        <h3>Post a Message</h3>
        <input type="text" id="username" placeholder="Username" required>
        <textarea id="content" placeholder="Message content" rows="4" required></textarea>
        <button type="submit">Post Message</button>
    </form>
    <div id="messages">`

	for _, msg := range messages {
		html += fmt.Sprintf(`
        <div class="message">
            <div class="username">%s</div>
            <div class="timestamp">%s</div>
            <div class="content">%s</div>
        </div>`, msg.Username, msg.CreatedAt.Format("2006-01-02 15:04:05"), msg.Content)
	}

	html += `
    </div>
    <div style="margin: 20px 0;">
        <a href="?limit=` + strconv.Itoa(limit) + `&offset=` + strconv.Itoa(offset-limit) + `&sort=` + strings.ToLower(sort) + `">Previous</a> | 
        <a href="?limit=` + strconv.Itoa(limit) + `&offset=` + strconv.Itoa(offset+limit) + `&sort=` + strings.ToLower(sort) + `">Next</a>
    </div>
    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
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
        });
    </script>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := c.BodyParser(&msg); err != nil {
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

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}