<CODE>
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
	ID        int       `json:"id"`
	Content   string    `json:"content"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString("An error occurred")
		},
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

func getMessages(c *fiber.Ctx) error {
	limit := c.QueryInt("limit", 10)
	offset := c.QueryInt("offset", 0)
	sort := c.Query("sort", "DESC")

	if limit < 0 || limit > 1000 {
		limit = 10
	}
	if offset < 0 {
		offset = 0
	}

	sortUpper := strings.ToUpper(sort)
	if sortUpper != "ASC" && sortUpper != "DESC" {
		sortUpper = "DESC"
	}

	query := fmt.Sprintf("SELECT id, content, username, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sortUpper)
	rows, err := db.Query(query, limit, offset)
	if err != nil {
		return err
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
		if err != nil {
			return err
		}
		messages = append(messages, msg)
	}

	if err = rows.Err(); err != nil {
		return err
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>MyForum</title></head><body>")
	htmlBuilder.WriteString("<h1>MyForum Messages</h1>")
	
	if len(messages) == 0 {
		htmlBuilder.WriteString("<p>No messages found.</p>")
	} else {
		htmlBuilder.WriteString("<ul>")
		for _, msg := range messages {
			htmlBuilder.WriteString("<li>")
			htmlBuilder.WriteString("<strong>")
			htmlBuilder.WriteString(html.EscapeString(msg.Username))
			htmlBuilder.WriteString("</strong>: ")
			htmlBuilder.WriteString(html.EscapeString(msg.Content))
			htmlBuilder.WriteString(" <em>(")
			htmlBuilder.WriteString(html.EscapeString(msg.CreatedAt.Format(time.RFC3339)))
			htmlBuilder.WriteString(")</em>")
			htmlBuilder.WriteString("</li>")
		}
		htmlBuilder.WriteString("</ul>")
	}
	
	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func postMessage(c *fiber.Ctx) error {
	var msg Message
	
	if err := json.Unmarshal(c.Body(), &msg); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if strings.TrimSpace(msg.Content) == "" || strings.TrimSpace(msg.Username) == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if len(msg.Content) > 10000 || len(msg.Username) > 100 {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	stmt, err := db.Prepare("INSERT INTO messages (content, username) VALUES (?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	_, err = stmt.Exec(msg.Content, msg.Username)
	if err != nil {
		return err
	}

	return c.SendStatus(fiber.StatusOK)
}
</CODE>