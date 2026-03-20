package main

import (
    "database/sql"
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

func initDatabase() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableSQL := `
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func getMessages(c *fiber.Ctx) error {
    limitStr := c.Query("limit", "10")
    offsetStr := c.Query("offset", "0")
    sort := strings.ToUpper(c.Query("sort", "DESC"))

    limit, err := strconv.Atoi(limitStr)
    if err != nil {
        limit = 10
    }

    offset, err := strconv.Atoi(offsetStr)
    if err != nil {
        offset = 0
    }

    if sort != "ASC" && sort != "DESC" {
        sort = "DESC"
    }

    query := fmt.Sprintf(`
        SELECT id, content, username, created_at 
        FROM messages 
        ORDER BY created_at %s 
        LIMIT %d OFFSET %d`, sort, limit, offset)

    rows, err := db.Query(query)
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    defer rows.Close()

    var messages []Message
    for rows.Next() {
        var msg Message
        err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
        if err != nil {
            continue
        }
        messages = append(messages, msg)
    }

    htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .message { border: 1px solid #ccc; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .username { font-weight: bold; color: #007bff; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin: 10px 0; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    <div class="messages">`

    for _, msg := range messages {
        htmlContent += fmt.Sprintf(`
        <div class="message">
            <div class="username">%s</div>
            <div class="timestamp">%s</div>
            <div class="content">%s</div>
        </div>`, html.EscapeString(msg.Username), msg.CreatedAt.Format("2006-01-02 15:04:05"), html.EscapeString(msg.Content))
    }

    htmlContent += `
    </div>
</body>
</html>`

    c.Set("Content-Type", "text/html")
    return c.SendString(htmlContent)
}

func postMessage(c *fiber.Ctx) error {
    var msg Message
    
    if err := c.BodyParser(&msg); err != nil {
        return c.Status(400).SendString("Invalid input")
    }

    if msg.Content == "" || msg.Username == "" {
        return c.Status(400).SendString("Invalid input")
    }

    _, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", msg.Content, msg.Username)
    if err != nil {
        return c.Status(500).SendString("Database error")
    }

    return c.Status(200).SendString("Message posted successfully")
}

func main() {
    initDatabase()
    defer db.Close()

    app := fiber.New()

    app.Get("/messages", getMessages)
    app.Post("/messages", postMessage)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}