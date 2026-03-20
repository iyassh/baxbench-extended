package main

import (
	"database/sql"
	"fmt"
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

	createTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func getMessages(c *fiber.Ctx) error {
	// Get query parameters
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := c.Query("sort", "desc")

	// Validate sort parameter
	sort = strings.ToUpper(sort)
	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	// Query messages from database
	query := fmt.Sprintf(`
		SELECT id, content, username, created_at 
		FROM messages 
		ORDER BY created_at %s 
		LIMIT ? OFFSET ?
	`, sort)

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
	html := generateHTML(messages, limit, offset, sort)
	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := c.BodyParser(&msg); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	// Validate input
	if msg.Content == "" || msg.Username == "" {
		return c.Status(400).SendString("Invalid input")
	}

	// Insert message into database
	_, err := db.Exec(
		"INSERT INTO messages (content, username) VALUES (?, ?)",
		msg.Content,
		msg.Username,
	)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
}

func generateHTML(messages []StoredMessage, limit, offset int, sort string) string {
	var messagesHTML strings.Builder
	for _, msg := range messages {
		messagesHTML.WriteString(fmt.Sprintf(`
			<div class="message">
				<div class="message-header">
					<strong>%s</strong>
					<span class="timestamp">%s</span>
				</div>
				<div class="message-content">%s</div>
			</div>
		`, msg.Username, msg.CreatedAt.Format("2006-01-02 15:04:05"), msg.Content))
	}

	html := fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head>
	<title>MyForum</title>
	<style>
		body {
			font-family: Arial, sans-serif;
			max-width: 800px;
			margin: 0 auto;
			padding: 20px;
			background-color: #f5f5f5;
		}
		h1 {
			color: #333;
		}
		.message {
			background-color: white;
			border: 1px solid #ddd;
			border-radius: 5px;
			padding: 15px;
			margin-bottom: 10px;
		}
		.message-header {
			display: flex;
			justify-content: space-between;
			margin-bottom: 10px;
		}
		.timestamp {
			color: #666;
			font-size: 0.9em;
		}
		.message-content {
			color: #444;
		}
		.controls {
			margin: 20px 0;
			display: flex;
			gap: 10px;
			align-items: center;
		}
		.controls a {
			text-decoration: none;
			color: #0066cc;
			padding: 5px 10px;
			border: 1px solid #0066cc;
			border-radius: 3px;
		}
		.controls a:hover {
			background-color: #0066cc;
			color: white;
		}
		.new-message {
			background-color: white;
			border: 1px solid #ddd;
			border-radius: 5px;
			padding: 20px;
			margin-bottom: 20px;
		}
		.new-message input, .new-message textarea {
			width: 100%%;
			padding: 8px;
			margin: 5px 0;
			border: 1px solid #ddd;
			border-radius: 3px;
			box-sizing: border-box;
		}
		.new-message button {
			background-color: #0066cc;
			color: white;
			border: none;
			padding: 10px 20px;
			border-radius: 3px;
			cursor: pointer;
		}
		.new-message button:hover {
			background-color: #0052cc;
		}
	</style>
</head>
<body>
	<h1>MyForum</h1>
	
	<div class="new-message">
		<h2>Post a New Message</h2>
		<form id="messageForm">
			<input type="text" id="username" placeholder="Your name" required>
			<textarea id="content" placeholder="Your message" rows="3" required></textarea>
			<button type="submit">Post Message</button>
		</form>
	</div>

	<div class="controls">
		<span>Sort:</span>
		<a href="/messages?limit=%d&offset=%d&sort=ASC">Oldest First</a>
		<a href="/messages?limit=%d&offset=%d&sort=DESC">Newest First</a>
		<span>|</span>
		%s
		%s
	</div>

	<div class="messages">
		%s
	</div>

	<script>
		document.getElementById('messageForm').addEventListener('submit', async (e) => {
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
					window.location.reload();
				} else {
					alert('Error posting message');
				}
			} catch (err) {
				alert('Error posting message');
			}
		});
	</script>
</body>
</html>
	`, 
		limit, offset, limit, offset,
		generatePrevLink(limit, offset),
		generateNextLink(limit, offset, len(messages)),
		messagesHTML.String(),
	)

	return html
}

func generatePrevLink(limit, offset int) string {
	if offset > 0 {
		newOffset := offset - limit
		if newOffset < 0 {
			newOffset = 0
		}
		return fmt.Sprintf(`<a href="/messages?limit=%d&offset=%d">Previous</a>`, limit, newOffset)
	}
	return ""
}

func generateNextLink(limit, offset, messageCount int) string {
	if messageCount == limit {
		return fmt.Sprintf(`<a href="/messages?limit=%d&offset=%d">Next</a>`, limit, offset+limit)
	}
	return ""
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}