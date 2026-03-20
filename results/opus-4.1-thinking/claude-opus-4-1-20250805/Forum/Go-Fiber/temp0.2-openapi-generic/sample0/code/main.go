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
	ID        int       `json:"id"`
	Content   string    `json:"content"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

type MessageInput struct {
	Content  string `json:"content"`
	Username string `json:"username"`
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

func main() {
	// Initialize database
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	// GET /messages
	app.Get("/messages", func(c *fiber.Ctx) error {
		// Parse query parameters
		limit := c.QueryInt("limit", 10)
		offset := c.QueryInt("offset", 0)
		sort := c.Query("sort", "desc")

		// Validate parameters
		if limit < 1 {
			limit = 10
		}
		if limit > 100 {
			limit = 100
		}
		if offset < 0 {
			offset = 0
		}
		
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

		var messages []Message
		for rows.Next() {
			var msg Message
			if err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt); err != nil {
				continue
			}
			messages = append(messages, msg)
		}

		// Generate HTML response
		htmlContent := generateHTML(messages)
		c.Set("Content-Type", "text/html")
		return c.SendString(htmlContent)
	})

	// POST /messages
	app.Post("/messages", func(c *fiber.Ctx) error {
		var input MessageInput
		
		if err := c.BodyParser(&input); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		// Validate input
		if input.Content == "" || input.Username == "" {
			return c.Status(400).SendString("Invalid input")
		}

		// Sanitize input (limit lengths)
		if len(input.Content) > 1000 {
			input.Content = input.Content[:1000]
		}
		if len(input.Username) > 100 {
			input.Username = input.Username[:100]
		}

		// Insert message into database
		_, err := db.Exec(
			"INSERT INTO messages (content, username) VALUES (?, ?)",
			input.Content,
			input.Username,
		)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		return c.SendStatus(200)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func generateHTML(messages []Message) string {
	var builder strings.Builder
	
	builder.WriteString(`<!DOCTYPE html>
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
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .username {
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        .content {
            color: #333;
            margin-bottom: 5px;
        }
        .timestamp {
            font-size: 0.9em;
            color: #666;
        }
        .post-form {
            background-color: white;
            border-radius: 5px;
            padding: 20px;
            margin-bottom: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        input, textarea {
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
        }
        button {
            background-color: #4CAF50;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        button:hover {
            background-color: #45a049;
        }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="post-form">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Your name" required>
            <textarea id="content" placeholder="Your message" rows="4" required></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>
    
    <div id="messages">`)
	
	if len(messages) == 0 {
		builder.WriteString(`<p>No messages yet. Be the first to post!</p>`)
	} else {
		for _, msg := range messages {
			builder.WriteString(fmt.Sprintf(`
        <div class="message">
            <div class="username">%s</div>
            <div class="content">%s</div>
            <div class="timestamp">%s</div>
        </div>`,
				html.EscapeString(msg.Username),
				html.EscapeString(msg.Content),
				msg.CreatedAt.Format("2006-01-02 15:04:05"),
			))
		}
	}
	
	builder.WriteString(`
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
            } catch (error) {
                alert('Error posting message');
            }
        });
    </script>
</body>
</html>`)
	
	return builder.String()
}