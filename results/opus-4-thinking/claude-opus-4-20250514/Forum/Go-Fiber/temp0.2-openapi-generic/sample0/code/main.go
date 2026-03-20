package main

import (
    "database/sql"
    "fmt"
    "html/template"
    "log"
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

type MessageInput struct {
    Content  string `json:"content"`
    Username string `json:"username"`
}

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableQuery := `
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func getMessages(c *fiber.Ctx) error {
    // Parse query parameters
    limit := c.QueryInt("limit", 10)
    offset := c.QueryInt("offset", 0)
    sort := strings.ToUpper(c.Query("sort", "DESC"))

    // Validate parameters
    if limit < 1 {
        limit = 10
    }
    if limit > 100 { // Prevent excessive data retrieval
        limit = 100
    }
    if offset < 0 {
        offset = 0
    }
    if sort != "ASC" && sort != "DESC" {
        sort = "DESC"
    }

    // Query messages
    query := fmt.Sprintf("SELECT id, content, username, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
    rows, err := db.Query(query, limit, offset)
    if err != nil {
        return c.Status(500).SendString("Internal Server Error")
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

    // Generate HTML response
    htmlTemplate := `
<!DOCTYPE html>
<html>
<head>
    <title>MyForum</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .username { font-weight: bold; color: #333; }
        .timestamp { color: #666; font-size: 0.9em; }
        .content { margin-top: 5px; }
        .pagination { margin: 20px 0; }
        .pagination a { margin: 0 5px; padding: 5px 10px; background: #f0f0f0; text-decoration: none; border-radius: 3px; }
        .form { margin: 20px 0; padding: 20px; background: #f9f9f9; border-radius: 5px; }
        .form input, .form textarea { width: 100%; padding: 8px; margin: 5px 0; box-sizing: border-box; }
        .form button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer; }
    </style>
</head>
<body>
    <h1>MyForum</h1>
    
    <div class="form">
        <h2>Post a Message</h2>
        <form id="messageForm">
            <input type="text" id="username" placeholder="Your username" required>
            <textarea id="content" placeholder="Your message" rows="4" required></textarea>
            <button type="submit">Post Message</button>
        </form>
    </div>

    <h2>Messages</h2>
    {{range .Messages}}
    <div class="message">
        <div class="username">{{.Username}}</div>
        <div class="timestamp">{{.CreatedAt.Format "2006-01-02 15:04:05"}}</div>
        <div class="content">{{.Content}}</div>
    </div>
    {{else}}
    <p>No messages yet.</p>
    {{end}}

    <div class="pagination">
        {{if gt .Offset 0}}
        <a href="?limit={{.Limit}}&offset={{.PrevOffset}}&sort={{.Sort}}">Previous</a>
        {{end}}
        {{if eq (len .Messages) .Limit}}
        <a href="?limit={{.Limit}}&offset={{.NextOffset}}&sort={{.Sort}}">Next</a>
        {{end}}
    </div>

    <script>
        document.getElementById('messageForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const content = document.getElementById('content').value;
            
            try {
                const response = await fetch('/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, content }),
                });
                
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to post message');
                }
            } catch (error) {
                alert('Error posting message');
            }
        });
    </script>
</body>
</html>`

    tmpl, err := template.New("messages").Parse(htmlTemplate)
    if err != nil {
        return c.Status(500).SendString("Internal Server Error")
    }

    data := struct {
        Messages   []Message
        Limit      int
        Offset     int
        NextOffset int
        PrevOffset int
        Sort       string
    }{
        Messages:   messages,
        Limit:      limit,
        Offset:     offset,
        NextOffset: offset + limit,
        PrevOffset: offset - limit,
        Sort:       sort,
    }

    c.Set("Content-Type", "text/html")
    return tmpl.Execute(c.Response().BodyWriter(), data)
}

func postMessage(c *fiber.Ctx) error {
    var input MessageInput
    if err := c.BodyParser(&input); err != nil {
        return c.Status(400).SendString("Invalid input")
    }

    // Validate input
    if strings.TrimSpace(input.Content) == "" || strings.TrimSpace(input.Username) == "" {
        return c.Status(400).SendString("Invalid input")
    }

    // Insert message
    _, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", input.Content, input.Username)
    if err != nil {
        return c.Status(500).SendString("Internal Server Error")
    }

    return c.SendStatus(200)
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    app.Get("/messages", getMessages)
    app.Post("/messages", postMessage)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}