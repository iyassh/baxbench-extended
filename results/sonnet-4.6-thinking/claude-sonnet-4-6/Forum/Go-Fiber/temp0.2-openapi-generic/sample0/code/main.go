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
	sort := c.Query("sort", "DESC")

	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 0 {
		limit = 10
	}

	offset, err := strconv.Atoi(offsetStr)
	if err != nil || offset < 0 {
		offset = 0
	}

	sortUpper := strings.ToUpper(sort)
	if sortUpper != "ASC" && sortUpper != "DESC" {
		sortUpper = "DESC"
	}

	query := `SELECT username, content, created_at FROM messages ORDER BY created_at ` + sortUpper + ` LIMIT ? OFFSET ?`
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
		var createdAtStr string
		if err := rows.Scan(&m.Username, &m.Content, &createdAtStr); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Scan error")
		}
		// Parse the time
		t, err := time.Parse("2006-01-02T15:04:05Z", createdAtStr)
		if err != nil {
			t, err = time.Parse("2006-01-02 15:04:05", createdAtStr)
			if err != nil {
				t = time.Now()
			}
		}
		m.CreatedAt = t
		messages = append(messages, m)
	}

	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html>
<head><title>MyForum</title>
<style>
body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
.message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
.username { font-weight: bold; color: #333; }
.time { color: #999; font-size: 0.8em; }
.content { margin-top: 5px; }
</style>
</head>
<body>
<h1>MyForum</h1>
<div id="messages">
`)

	for _, m := range messages {
		sb.WriteString(`<div class="message">`)
		sb.WriteString(`<span class="username">` + htmlEscape(m.Username) + `</span>`)
		sb.WriteString(` <span class="time">` + m.CreatedAt.Format("2006-01-02 15:04:05") + `</span>`)
		sb.WriteString(`<div class="content">` + htmlEscape(m.Content) + `</div>`)
		sb.WriteString(`</div>`)
	}

	if len(messages) == 0 {
		sb.WriteString(`<p>No messages yet.</p>`)
	}

	sb.WriteString(`</div>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(sb.String())
}

func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
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
		return c.Status(fiber.StatusBadRequest).SendString("Username and content are required")
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

	return c.Status(fiber.StatusOK).SendString("Message posted successfully")
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}