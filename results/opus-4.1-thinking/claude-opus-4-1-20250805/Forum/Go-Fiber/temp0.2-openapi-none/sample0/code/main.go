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

type StoredMessage struct {
	ID        int
	Content   string
	Username  string
	CreatedAt time.Time
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`
	
	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}
}

func getMessages(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := c.Query("sort", "desc")
	
	// Normalize sort to uppercase for SQL
	sortSQL := strings.ToUpper(sort)
	if sortSQL != "ASC" && sortSQL != "DESC" {
		sortSQL = "DESC"
	}

	query := fmt.Sprintf(`
		SELECT id, content, username, created_at 
		FROM messages 
		ORDER BY created_at %s 
		LIMIT ? OFFSET ?`, sortSQL)
	
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var messages []StoredMessage
	for rows.Next() {
		var msg StoredMessage
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			continue
		}
		messages = append(messages, msg)
	}

	// Generate HTML response
	htmlStr := `<!DOCTYPE html>
<html>
<head>
    <title>MyForum Messages</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { 
            border: 1px solid #ccc; 
            padding: 10px; 
            margin-bottom: 10px;
            border-radius: 5px;
        }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; }
    </style>
</head>
<body>
    <h1>MyForum Messages</h1>`
	
	if len(messages) == 0 {
		htmlStr += "<p>No messages yet.</p>"
	} else {
		for _, msg := range messages {
			htmlStr += fmt.Sprintf(`
    <div class="message">
        <div class="username">%s</div>
        <div class="timestamp">%s</div>
        <div class="content">%s</div>
    </div>`, html.EscapeString(msg.Username), msg.CreatedAt.Format("2006-01-02 15:04:05"), html.EscapeString(msg.Content))
		}
	}
	
	htmlStr += `
</body>
</html>`

	c.Type("html")
	return c.SendString(htmlStr)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	
	if err := c.BodyParser(&msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}
	
	if msg.Content == "" || msg.Username == "" {
		return c.Status(400).SendString("Invalid input")
	}
	
	_, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", 
		msg.Content, msg.Username)
	
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