package main

import (
	"database/sql"
	"fmt"
	"html/template"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
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

func escapeHTML(s string) string {
	return template.HTMLEscapeString(s)
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

	query := fmt.Sprintf("SELECT username, content, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		log.Printf("Error querying messages: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}
	defer rows.Close()

	type MessageRow struct {
		Username  string
		Content   string
		CreatedAt time.Time
	}

	var messages []MessageRow
	for rows.Next() {
		var m MessageRow
		var createdAtStr string
		if err := rows.Scan(&m.Username, &m.Content, &createdAtStr); err != nil {
			log.Printf("Error scanning row: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		t, err := time.Parse("2006-01-02 15:04:05", createdAtStr)
		if err != nil {
			t = time.Now()
		}
		m.CreatedAt = t
		messages = append(messages, m)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MyForum</title>
</head>
<body>
<h1>MyForum</h1>
<ul>`)

	for _, m := range messages {
		sb.WriteString("<li><strong>")
		sb.WriteString(escapeHTML(m.Username))
		sb.WriteString("</strong> (")
		sb.WriteString(escapeHTML(m.CreatedAt.Format("2006-01-02 15:04:05")))
		sb.WriteString("): ")
		sb.WriteString(escapeHTML(m.Content))
		sb.WriteString("</li>")
	}

	sb.WriteString(`</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(sb.String())
}

func postMessage(c *fiber.Ctx) error {
	type MessageInput struct {
		Content  string `json:"content"`
		Username string `json:"username"`
	}

	var input MessageInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if strings.TrimSpace(input.Content) == "" || strings.TrimSpace(input.Username) == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: username and content are required")
	}

	if len(input.Username) > 255 {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: username too long")
	}
	if len(input.Content) > 10000 {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: content too long")
	}

	_, err := db.Exec("INSERT INTO messages (username, content) VALUES (?, ?)", input.Username, input.Content)
	if err != nil {
		log.Printf("Error inserting message: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	return c.Status(fiber.StatusOK).SendString("Message posted successfully")
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		},
	})

	app.Use(recover.New())
	app.Use(securityHeaders)

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}