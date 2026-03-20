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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTableQuery)
	return err
}

func getMessages(c *fiber.Ctx) error {
	// Parse query parameters
	limitStr := c.Query("limit", "10")
	offsetStr := c.Query("offset", "0")
	sort := strings.ToUpper(c.Query("sort", "DESC"))

	// Parse and validate limit
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}

	// Parse and validate offset
	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	// Validate sort
	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	// Query messages - Using parameterized query for limit/offset, validated sort
	query := fmt.Sprintf(`
		SELECT id, content, username, created_at 
		FROM messages 
		ORDER BY created_at %s 
		LIMIT ? OFFSET ?
	`, sort)

	rows, err := db.Query(query, limit, offset)
	if err != nil {
		log.Printf("Database query error")
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	var messages []StoredMessage
	for rows.Next() {
		var msg StoredMessage
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			log.Printf("Row scan error")
			continue
		}
		messages = append(messages, msg)
	}

	// Generate HTML response
	htmlContent := generateHTML(messages)
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
	// Verify Content-Type for CSRF protection
	contentType := c.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		return c.Status(400).SendString("Invalid input")
	}

	var msg Message
	
	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Validate input
	msg.Content = strings.TrimSpace(msg.Content)
	msg.Username = strings.TrimSpace(msg.Username)
	
	if msg.Content == "" || msg.Username == "" {
		return c.Status(400).SendString("Invalid input")
	}
	
	if len(msg.Content) > 10000 {
		return c.Status(400).SendString("Invalid input")
	}
	
	if len(msg.Username) > 100 {
		return c.Status(400).SendString("Invalid input")
	}

	// Insert message using parameterized query to prevent SQL injection
	_, err := db.Exec(
		"INSERT INTO messages (content, username) VALUES (?, ?)",
		msg.Content, msg.Username,
	)
	if err != nil {
		log.Printf("Database insert error")
		return c.Status(500).SendString("Internal Server Error")
	}

	return c.SendStatus(200)
}

func generateHTML(messages []StoredMessage) string {
	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; max-width: 800px; }
        .message { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; white-space: pre-wrap; word-wrap: break-word; }
    </style>
</head>
<body>
    <h1>MyForum Messages</h1>
`)

	if len(messages) == 0 {
		sb.WriteString("<p>No messages found.</p>")
	} else {
		for _, msg := range messages {
			sb.WriteString(fmt.Sprintf(`
    <div class="message">
        <span class="username">%s</span>
        <span class="timestamp">(%s)</span>
        <div class="content">%s</div>
    </div>`,
				html.EscapeString(msg.Username),
				html.EscapeString(msg.CreatedAt.Format("2006-01-02 15:04:05")),
				html.EscapeString(msg.Content),
			))
		}
	}

	sb.WriteString(`
</body>
</html>`)
	return sb.String()
}

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database")
	}
	defer db.Close()

	// Create Fiber app with error handling
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			// Don't expose error details
			return c.Status(code).SendString("An error occurred")
		},
		DisableStartupMessage: false,
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		// Security headers
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline' 'self';")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	// Routes
	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Printf("Server starting on http://0.0.0.0:5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}