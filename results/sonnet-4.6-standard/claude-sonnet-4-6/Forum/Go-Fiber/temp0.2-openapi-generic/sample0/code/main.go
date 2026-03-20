package main

import (
	"database/sql"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func getMessages(c *fiber.Ctx) error {
	limitStr := c.Query("limit", "10")
	offsetStr := c.Query("offset", "0")
	sort := strings.ToUpper(c.Query("sort", "DESC"))

	if sort != "ASC" && sort != "DESC" {
		sort = "DESC"
	}

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 0 {
		limit = 10
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	query := `SELECT username, content, created_at FROM messages ORDER BY created_at ` + sort + ` LIMIT ? OFFSET ?`
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
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
		var createdAt string
		if err := rows.Scan(&m.Username, &m.Content, &createdAt); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Scan error")
		}
		t, err := time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			t = time.Now()
		}
		m.CreatedAt = t
		messages = append(messages, m)
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>MyForum</title></head>
<body>
<h1>MyForum</h1>
<ul>`)

	for _, m := range messages {
		sb.WriteString("<li><strong>")
		sb.WriteString(escapeHTML(m.Username))
		sb.WriteString("</strong> (")
		sb.WriteString(m.CreatedAt.Format("2006-01-02 15:04:05"))
		sb.WriteString("): ")
		sb.WriteString(escapeHTML(m.Content))
		sb.WriteString("</li>")
	}

	sb.WriteString(`</ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
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
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input: content and username are required")
	}

	if len(input.Content) > 10000 {
		return c.Status(fiber.StatusBadRequest).SendString("Content too long")
	}
	if len(input.Username) > 255 {
		return c.Status(fiber.StatusBadRequest).SendString("Username too long")
	}

	_, err := db.Exec(`INSERT INTO messages (username, content) VALUES (?, ?)`, input.Username, input.Content)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	return c.SendStatus(fiber.StatusOK)
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}