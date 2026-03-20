package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Message struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

var db *sql.DB

func initDatabase() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	query := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(query)
	return err
}

func getMessages(c *fiber.Ctx) error {
	// Parse query parameters
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := strings.ToUpper(c.Query("sort", "DESC"))
	
	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	query := fmt.Sprintf(`
		SELECT content, username, created_at 
		FROM messages 
		ORDER BY created_at %s 
		LIMIT ? OFFSET ?`, sort)

	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var htmlContent strings.Builder
	htmlContent.WriteString(`<!DOCTYPE html>
<html>
<head>
	<title>MyForum</title>
	<style>
		body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
		.message { border: 1px solid #ccc; margin: 10px 0; padding: 15px; border-radius: 5px; }
		.username { font-weight: bold; color: #333; }
		.timestamp { color: #666; font-size: 0.9em; }
		.content { margin: 10px 0; }
	</style>
</head>
<body>
	<h1>MyForum Messages</h1>`)

	for rows.Next() {
		var content, username, timestamp string
		err := rows.Scan(&content, &username, &timestamp)
		if err != nil {
			continue
		}

		htmlContent.WriteString(fmt.Sprintf(`
	<div class="message">
		<div class="username">%s</div>
		<div class="timestamp">%s</div>
		<div class="content">%s</div>
	</div>`, 
			html.EscapeString(username),
			html.EscapeString(timestamp),
			html.EscapeString(content)))
	}

	htmlContent.WriteString(`
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent.String())
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	
	if err := c.BodyParser(&msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if strings.TrimSpace(msg.Content) == "" || strings.TrimSpace(msg.Username) == "" {
		return c.Status(400).SendString("Invalid input")
	}

	query := `INSERT INTO messages (content, username) VALUES (?, ?)`
	_, err := db.Exec(query, msg.Content, msg.Username)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
}

func main() {
	err := initDatabase()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}