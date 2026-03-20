package main

import (
    "database/sql"
    "fmt"
    "html"
    "log"
    "strconv"
    "time"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

type Message struct {
    Content  string `json:"content"`
    Username string `json:"username"`
}

type DBMessage struct {
    ID        int       `db:"id"`
    Content   string    `db:"content"`
    Username  string    `db:"username"`
    CreatedAt time.Time `db:"created_at"`
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

func securityMiddleware(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func getMessages(c *fiber.Ctx) error {
    // Parse query parameters
    limitStr := c.Query("limit", "10")
    offsetStr := c.Query("offset", "0")
    sort := c.Query("sort", "desc")

    limit, err := strconv.Atoi(limitStr)
    if err != nil || limit < 0 || limit > 100 {
        limit = 10
    }

    offset, err := strconv.Atoi(offsetStr)
    if err != nil || offset < 0 {
        offset = 0
    }

    // Handle sort parameter - validate and sanitize
    var query string
    if sort == "ASC" || sort == "asc" {
        query = "SELECT id, content, username, created_at FROM messages ORDER BY created_at ASC LIMIT ? OFFSET ?"
    } else {
        // Default to DESC for "DESC", "desc", or any invalid value
        query = "SELECT id, content, username, created_at FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?"
    }
    
    rows, err := db.Query(query, limit, offset)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    var messages []DBMessage
    for rows.Next() {
        var msg DBMessage
        err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
        if err != nil {
            return c.Status(500).SendString("Internal server error")
        }
        messages = append(messages, msg)
    }

    // Generate HTML response
    htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <meta charset="UTF-8">
</head>
<body>
    <h1>MyForum Messages</h1>`

    if len(messages) == 0 {
        htmlContent += "<p>No messages found.</p>"
    } else {
        htmlContent += "<div>"
        for _, msg := range messages {
            htmlContent += fmt.Sprintf(
                `<div style="border: 1px solid #ccc; margin: 10px; padding: 10px;">
                    <strong>%s</strong> - %s<br>
                    <p>%s</p>
                </div>`,
                html.EscapeString(msg.Username),
                msg.CreatedAt.Format("2006-01-02 15:04:05"),
                html.EscapeString(msg.Content),
            )
        }
        htmlContent += "</div>"
    }

    htmlContent += "</body></html>"

    c.Set("Content-Type", "text/html; charset=utf-8")
    return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
    var msg Message

    // Parse JSON body
    if err := c.BodyParser(&msg); err != nil {
        return c.Status(400).SendString("Invalid input")
    }

    // Validate input
    if msg.Username == "" || msg.Content == "" {
        return c.Status(400).SendString("Invalid input")
    }

    // Prevent excessively long content
    if len(msg.Content) > 1000 || len(msg.Username) > 50 {
        return c.Status(400).SendString("Invalid input")
    }

    // Insert into database using prepared statement
    _, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", msg.Content, msg.Username)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    return c.SendStatus(200)
}

func main() {
    err := initDB()
    if err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            return c.Status(500).SendString("Internal server error")
        },
    })

    app.Use(securityMiddleware)

    app.Get("/messages", getMessages)
    app.Post("/messages", postMessage)

    log.Println("Server starting on :5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}