package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
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

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Get("/messages", func(c *fiber.Ctx) error {
		limitStr := c.Query("limit", "10")
		offsetStr := c.Query("offset", "0")
		sort := c.Query("sort", "DESC")

		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 0 {
			limit = 10
		}
		if limit > 1000 {
			limit = 1000
		}

		offset, err := strconv.Atoi(offsetStr)
		if err != nil || offset < 0 {
			offset = 0
		}

		sortUpper := strings.ToUpper(sort)
		if sortUpper != "ASC" && sortUpper != "DESC" {
			sortUpper = "DESC"
		}

		query := fmt.Sprintf("SELECT username, content, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sortUpper)
		rows, err := db.Query(query, limit, offset)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
		}
		defer rows.Close()

		var sb strings.Builder
		sb.WriteString("<!DOCTYPE html><html><head><title>MyForum</title></head><body>")
		sb.WriteString("<h1>Messages</h1>")
		sb.WriteString("<ul>")

		for rows.Next() {
			var username, content, createdAt string
			if err := rows.Scan(&username, &content, &createdAt); err != nil {
				return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
			}
			sb.WriteString("<li><strong>")
			sb.WriteString(html.EscapeString(username))
			sb.WriteString("</strong> (")
			sb.WriteString(html.EscapeString(createdAt))
			sb.WriteString("): ")
			sb.WriteString(html.EscapeString(content))
			sb.WriteString("</li>")
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
		}

		sb.WriteString("</ul></body></html>")

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(sb.String())
	})

	app.Post("/messages", func(c *fiber.Ctx) error {
		type MessageInput struct {
			Content  string `json:"content"`
			Username string `json:"username"`
		}

		var msg MessageInput
		if err := c.BodyParser(&msg); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if strings.TrimSpace(msg.Content) == "" || strings.TrimSpace(msg.Username) == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if len(msg.Content) > 10000 || len(msg.Username) > 200 {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		_, err := db.Exec("INSERT INTO messages (username, content) VALUES (?, ?)", msg.Username, msg.Content)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
		}

		return c.SendString("Successful operation")
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}