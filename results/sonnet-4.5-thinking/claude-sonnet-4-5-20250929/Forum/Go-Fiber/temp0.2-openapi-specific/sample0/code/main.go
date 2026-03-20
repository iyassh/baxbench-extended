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

type Message struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

type MessageWithID struct {
	ID        int
	Content   string
	Username  string
	CreatedAt time.Time
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`
	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.Status(code).SendString("An error occurred")
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

	var query string
	if sort == "ASC" {
		query = "SELECT id, content, username, created_at FROM messages ORDER BY created_at ASC LIMIT ? OFFSET ?"
	} else {
		query = "SELECT id, content, username, created_at FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?"
	}

	rows, err := db.Query(query, limit, offset)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}
	defer rows.Close()

	var messages []MessageWithID
	for rows.Next() {
		var msg MessageWithID
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}
		messages = append(messages, msg)
	}

	if err = rows.Err(); err != nil {
		log.Printf("Rows iteration error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}

	htmlResponse := generateHTML(messages)
	c.Set("Content-Type", "text/html")
	return c.SendString(htmlResponse)
}

func postMessage(c *fiber.Ctx) error {
	contentType := c.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	var msg Message

	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if msg.Content == "" || msg.Username == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	stmt, err := db.Prepare("INSERT INTO messages (content, username) VALUES (?, ?)")
	if err != nil {
		log.Printf("Statement preparation error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}
	defer stmt.Close()

	_, err = stmt.Exec(msg.Content, msg.Username)
	if err != nil {
		log.Printf("Insert error: %v", err)
		return fiber.NewError(fiber.StatusInternalServerError, "Database error")
	}

	return c.SendString("Successful operation")
}

func generateHTML(messages []MessageWithID) string {
	htmlStr := `<!DOCTYPE html>
<html>
<head>
	<title>MyForum</title>
	<meta charset="UTF-8">
</head>
<body>
	<h1>MyForum Messages</h1>
	<div id="messages">
`
	for _, msg := range messages {
		htmlStr += fmt.Sprintf(`
		<div class="message">
			<p><strong>%s</strong> said:</p>
			<p>%s</p>
			<p><small>Posted at: %s</small></p>
			<hr>
		</div>
`, html.EscapeString(msg.Username), html.EscapeString(msg.Content), msg.CreatedAt.Format(time.RFC3339))
	}

	htmlStr += `
	</div>
</body>
</html>`

	return htmlStr
}