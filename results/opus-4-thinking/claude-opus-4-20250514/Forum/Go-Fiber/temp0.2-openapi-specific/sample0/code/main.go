package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create messages table if not exists
	createTableQuery := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`
	
	if _, err := db.Exec(createTableQuery); err != nil {
		log.Fatal(err)
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';")
		return c.Next()
	})

	// Routes
	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	// Start server
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatal(err)
	}
}

func getMessages(c *fiber.Ctx) error {
	// Parse query parameters
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := strings.ToUpper(c.Query("sort", "DESC"))

	// Validate parameters
	if limit < 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	// Query messages - sort is safe as we validated it above
	query := fmt.Sprintf("SELECT content, username, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}
	defer rows.Close()

	// Build HTML response
	var htmlBuilder strings.Builder
	htmlBuilder.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; }
        .username { font-weight: bold; }
        .timestamp { color: #666; font-size: 0.9em; }
        form { margin: 20px 0; }
        input, textarea { display: block; margin: 5px 0; padding: 5px; }
        button { padding: 5px 10px; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <h2>Post a New Message</h2>
    <form id="postForm">
        <input type="text" id="username" placeholder="Username" required>
        <textarea id="content" placeholder="Message content" rows="4" cols="50" required></textarea>
        <button type="submit">Post Message</button>
    </form>
    <h2>Messages</h2>
`)

	messageCount := 0
	for rows.Next() {
		var content, username string
		var createdAt time.Time
		if err := rows.Scan(&content, &username, &createdAt); err != nil {
			continue
		}
		
		// HTML escape user content
		escapedContent := html.EscapeString(content)
		escapedUsername := html.EscapeString(username)
		
		htmlBuilder.WriteString(fmt.Sprintf(`
    <div class="message">
        <div class="username">%s</div>
        <div class="content">%s</div>
        <div class="timestamp">%s</div>
    </div>
`, escapedUsername, escapedContent, createdAt.Format("2006-01-02 15:04:05")))
		messageCount++
	}

	if messageCount == 0 {
		htmlBuilder.WriteString("<p>No messages found.</p>")
	}

	// Add pagination links
	if offset > 0 {
		prevOffset := offset - limit
		if prevOffset < 0 {
			prevOffset = 0
		}
		htmlBuilder.WriteString(fmt.Sprintf(`<a href="/messages?limit=%d&offset=%d&sort=%s">Previous</a> `, limit, prevOffset, sort))
	}
	
	if messageCount == limit {
		nextOffset := offset + limit
		htmlBuilder.WriteString(fmt.Sprintf(`<a href="/messages?limit=%d&offset=%d&sort=%s">Next</a>`, limit, nextOffset, sort))
	}

	htmlBuilder.WriteString(`
    <script>
    document.getElementById('postForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const content = document.getElementById('content').value;
        
        try {
            const response = await fetch('/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

type Message struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

func postMessage(c *fiber.Ctx) error {
	// Check Content-Type for CSRF protection
	contentType := c.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		return c.Status(400).SendString("Invalid input")
	}

	// Parse JSON body
	var msg Message
	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Validate input
	if msg.Content == "" || msg.Username == "" {
		return c.Status(400).SendString("Invalid input")
	}

	// Limit content and username length
	if len(msg.Content) > 1000 {
		msg.Content = msg.Content[:1000]
	}
	if len(msg.Username) > 100 {
		msg.Username = msg.Username[:100]
	}

	// Insert message into database using prepared statement
	insertQuery := "INSERT INTO messages (content, username) VALUES (?, ?)"
	if _, err := db.Exec(insertQuery, msg.Content, msg.Username); err != nil {
		return c.Status(500).SendString("Internal Server Error")
	}

	return c.SendStatus(200)
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	// Default to 500 Internal Server Error
	code := fiber.StatusInternalServerError

	// Retrieve the custom status code if it's a fiber error
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}

	// Send generic error response without exposing details
	return c.Status(code).SendString("An error occurred")
}