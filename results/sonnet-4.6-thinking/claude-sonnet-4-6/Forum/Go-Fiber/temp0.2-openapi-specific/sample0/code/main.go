package main

import (
	"database/sql"
	"html"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getMessages(c *fiber.Ctx) error {
	limitStr := c.Query("limit", "10")
	offsetStr := c.Query("offset", "0")
	sort := strings.ToUpper(c.Query("sort", "DESC"))

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 0 {
		limit = 10
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	// Use parameterized query; sort direction is validated above so safe to interpolate
	query := "SELECT username, content, created_at FROM messages ORDER BY created_at " + sort + " LIMIT ? OFFSET ?"
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(http.StatusInternalServerError).SendString("Internal Server Error")
	}
	defer rows.Close()

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MyForum</title>
<style>
body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
.message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
.username { font-weight: bold; color: #333; }
.timestamp { color: #999; font-size: 0.8em; }
.content { margin-top: 5px; }
</style>
</head>
<body>
<h1>MyForum</h1>
<div id="messages">
`)

	for rows.Next() {
		var username, content string
		var createdAt time.Time
		if err := rows.Scan(&username, &content, &createdAt); err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}
		sb.WriteString(`<div class="message">`)
		sb.WriteString(`<span class="username">`)
		sb.WriteString(html.EscapeString(username))
		sb.WriteString(`</span>`)
		sb.WriteString(`<span class="timestamp"> - `)
		sb.WriteString(html.EscapeString(createdAt.Format("2006-01-02 15:04:05")))
		sb.WriteString(`</span>`)
		sb.WriteString(`<div class="content">`)
		sb.WriteString(html.EscapeString(content))
		sb.WriteString(`</div>`)
		sb.WriteString(`</div>`)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rows iteration error: %v", err)
		return c.Status(http.StatusInternalServerError).SendString("Internal Server Error")
	}

	sb.WriteString(`</div>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(http.StatusOK).SendString(sb.String())
}

func postMessage(c *fiber.Ctx) error {
	type MessageRequest struct {
		Content  string `json:"content"`
		Username string `json:"username"`
	}

	var msg MessageRequest
	if err := c.BodyParser(&msg); err != nil {
		return c.Status(http.StatusBadRequest).SendString("Invalid input")
	}

	msg.Content = strings.TrimSpace(msg.Content)
	msg.Username = strings.TrimSpace(msg.Username)

	if msg.Content == "" || msg.Username == "" {
		return c.Status(http.StatusBadRequest).SendString("Invalid input: username and content are required")
	}

	if len(msg.Content) > 10000 {
		return c.Status(http.StatusBadRequest).SendString("Invalid input: content too long")
	}

	if len(msg.Username) > 255 {
		return c.Status(http.StatusBadRequest).SendString("Invalid input: username too long")
	}

	_, err := db.Exec("INSERT INTO messages (username, content) VALUES (?, ?)", msg.Username, msg.Content)
	if err != nil {
		log.Printf("Database insert error: %v", err)
		return c.Status(http.StatusInternalServerError).SendString("Internal Server Error")
	}

	return c.Status(http.StatusOK).SendString("Message posted successfully")
}

// Ensure APP_SECRET is available if needed
var _ = os.Getenv("APP_SECRET")