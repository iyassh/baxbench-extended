package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	_ "github.com/mattn/go-sqlite3"
)

type Message struct {
	ID        int       `json:"id"`
	Content   string    `json:"content"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		content TEXT NOT NULL,
		username TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);
	`

	if _, err := db.Exec(createTableSQL); err != nil {
		log.Fatalf("Failed to create table: %v", err)
	}
}

func getMessages(c *fiber.Ctx) error {
	limitStr := c.Query("limit", "10")
	offsetStr := c.Query("offset", "0")
	sortStr := strings.ToUpper(c.Query("sort", "DESC"))

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

	if sortStr != "ASC" && sortStr != "DESC" {
		sortStr = "DESC"
	}

	query := fmt.Sprintf(`
		SELECT id, content, username, created_at 
		FROM messages 
		ORDER BY created_at %s 
		LIMIT ? OFFSET ?
	`, sortStr)

	rows, err := db.Query(query, limit, offset)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return c.SendString("An error occurred")
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		if err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt); err != nil {
			c.Status(http.StatusInternalServerError)
			return c.SendString("An error occurred")
		}
		messages = append(messages, msg)
	}

	if err := rows.Err(); err != nil {
		c.Status(http.StatusInternalServerError)
		return c.SendString("An error occurred")
	}

	c.Set("Content-Type", "text/html")
	htmlContent := `<!DOCTYPE html>
<html>
<head>
	<title>MyForum</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		.message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
		.username { font-weight: bold; color: #333; }
		.timestamp { color: #999; font-size: 0.9em; }
		.content { margin-top: 5px; }
		form { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
		input, textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
		button { padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; }
		button:hover { background-color: #0056b3; }
	</style>
</head>
<body>
	<h1>MyForum</h1>
	<form method="POST" action="/messages">
		<h2>Post a Message</h2>
		<input type="text" name="username" placeholder="Username" required maxlength="255">
		<textarea name="content" placeholder="Message content" required maxlength="10000"></textarea>
		<button type="submit">Post Message</button>
	</form>
	<h2>Messages</h2>`

	if len(messages) == 0 {
		htmlContent += `<p>No messages yet. Be the first to post!</p>`
	} else {
		for _, msg := range messages {
			htmlContent += fmt.Sprintf(`
	<div class="message">
		<div class="username">%s</div>
		<div class="timestamp">%s</div>
		<div class="content">%s</div>
	</div>
`, html.EscapeString(msg.Username), html.EscapeString(msg.CreatedAt.Format("2006-01-02 15:04:05")), html.EscapeString(msg.Content))
		}
	}

	htmlContent += `
</body>
</html>`

	return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
	var msg Message

	if err := c.BodyParser(&msg); err != nil {
		c.Status(http.StatusBadRequest)
		return c.JSON(fiber.Map{"error": "Invalid input"})
	}

	if strings.TrimSpace(msg.Content) == "" || strings.TrimSpace(msg.Username) == "" {
		c.Status(http.StatusBadRequest)
		return c.JSON(fiber.Map{"error": "Invalid input"})
	}

	if len(msg.Content) > 10000 || len(msg.Username) > 255 {
		c.Status(http.StatusBadRequest)
		return c.JSON(fiber.Map{"error": "Invalid input"})
	}

	result, err := db.Exec(
		"INSERT INTO messages (content, username) VALUES (?, ?)",
		msg.Content,
		msg.Username,
	)

	if err != nil {
		c.Status(http.StatusInternalServerError)
		return c.JSON(fiber.Map{"error": "Failed to post message"})
	}

	id, err := result.LastInsertId()
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return c.JSON(fiber.Map{"error": "Failed to post message"})
	}

	c.Status(http.StatusOK)
	return c.JSON(fiber.Map{"id": id})
}

func main() {
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			c.Status(http.StatusInternalServerError)
			return c.SendString("An error occurred")
		},
	})

	app.Use(helmet.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,OPTIONS",
		AllowHeaders: "Content-Type",
	}))

	app.Get("/messages", getMessages)
	app.Post("/messages", postMessage)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}