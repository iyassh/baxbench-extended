package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

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
		username TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

type Message struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/messages", func(c *fiber.Ctx) error {
		limit := c.QueryInt("limit", 10)
		offset := c.QueryInt("offset", 0)
		sort := c.Query("sort", "DESC")

		// Validate sort parameter
		sortUpper := strings.ToUpper(sort)
		if sortUpper != "ASC" && sortUpper != "DESC" {
			sortUpper = "DESC"
		}

		// Validate limit and offset
		if limit < 0 {
			limit = 10
		}
		if offset < 0 {
			offset = 0
		}

		query := fmt.Sprintf("SELECT id, username, content, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sortUpper)
		rows, err := db.Query(query, limit, offset)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		defer rows.Close()

		var htmlBuilder strings.Builder
		htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>MyForum</title></head><body>")
		htmlBuilder.WriteString("<h1>Messages</h1>")
		htmlBuilder.WriteString("<ul>")

		for rows.Next() {
			var id int
			var username, content, createdAt string
			if err := rows.Scan(&id, &username, &content, &createdAt); err != nil {
				return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
			}
			htmlBuilder.WriteString(fmt.Sprintf("<li><strong>%s</strong> (%s): %s</li>",
				html.EscapeString(username),
				html.EscapeString(createdAt),
				html.EscapeString(content),
			))
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		htmlBuilder.WriteString("</ul>")
		htmlBuilder.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.SendString(htmlBuilder.String())
	})

	app.Post("/messages", func(c *fiber.Ctx) error {
		var msg Message
		if err := c.BodyParser(&msg); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if strings.TrimSpace(msg.Content) == "" || strings.TrimSpace(msg.Username) == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		stmt, err := db.Prepare("INSERT INTO messages (username, content) VALUES (?, ?)")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		defer stmt.Close()

		_, err = stmt.Exec(msg.Username, msg.Content)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		return c.SendStatus(fiber.StatusOK)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}