package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/csrf"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/utils"
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

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString("An error occurred")
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// CSRF protection
	appSecret := os.Getenv("APP_SECRET")
	if appSecret == "" {
		appSecret = utils.UUIDv4()
	}
	app.Use(csrf.New(csrf.Config{
		KeyLookup:      "header:X-Csrf-Token",
		CookieName:     "csrf_",
		CookieSameSite: "Strict",
		Expiration:     1 * time.Hour,
		KeyGenerator:   utils.UUIDv4,
		ContextKey:     "csrf",
		Secret:         []byte(appSecret),
	}))

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
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

	query := `SELECT id, content, username, created_at FROM messages ORDER BY created_at ` + sort + ` LIMIT ? OFFSET ?`
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
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

	csrfToken := c.Locals("csrf").(string)

	htmlContent := `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; }
        .timestamp { color: #666; font-size: 0.9em; }
        form { margin: 20px 0; padding: 20px; border: 1px solid #ccc; border-radius: 5px; }
        input, textarea { width: 100%; margin: 5px 0; padding: 5px; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <form id="messageForm">
        <h2>Post a Message</h2>
        <input type="text" id="username" placeholder="Username" required>
        <textarea id="content" placeholder="Message content" required></textarea>
        <button type="submit">Post Message</button>
    </form>
    <h2>Messages</h2>
    <div id="messages">`

	for _, msg := range messages {
		htmlContent += fmt.Sprintf(`
        <div class="message">
            <div class="username">%s</div>
            <div class="content">%s</div>
            <div class="timestamp">%s</div>
        </div>`,
			html.EscapeString(msg.Username),
			html.EscapeString(msg.Content),
			html.EscapeString(msg.CreatedAt.Format("2006-01-02 15:04:05")))
	}

	htmlContent += `
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
                        'X-Csrf-Token': '` + csrfToken + `'
                    },
                    body: JSON.stringify({ username, content })
                });
                
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to post message');
                }
            } catch (error) {
                alert('An error occurred');
            }
        });
    </script>
</body>
</html>`

	c.Set("Content-Type", "text/html; charset=utf-8")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'")
	
	return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	msg.Content = strings.TrimSpace(msg.Content)
	msg.Username = strings.TrimSpace(msg.Username)

	if msg.Content == "" || msg.Username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if len(msg.Content) > 1000 || len(msg.Username) > 100 {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	query := `INSERT INTO messages (content, username) VALUES (?, ?)`
	_, err := db.Exec(query, msg.Content, msg.Username)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
	}

	return c.SendStatus(fiber.StatusOK)
}