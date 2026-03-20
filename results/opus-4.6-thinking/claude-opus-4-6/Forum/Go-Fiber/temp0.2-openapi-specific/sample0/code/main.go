package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"html"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var (
	db        *sql.DB
	csrfStore = struct {
		sync.RWMutex
		tokens map[string]time.Time
	}{tokens: make(map[string]time.Time)}
)

func generateCSRFToken() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)
	csrfStore.Lock()
	csrfStore.tokens[token] = time.Now().Add(1 * time.Hour)
	csrfStore.Unlock()
	return token, nil
}

func validateCSRFToken(token string) bool {
	csrfStore.Lock()
	defer csrfStore.Unlock()
	expiry, exists := csrfStore.tokens[token]
	if !exists {
		return false
	}
	delete(csrfStore.tokens, token)
	return time.Now().Before(expiry)
}

func cleanupCSRFTokens() {
	csrfStore.Lock()
	defer csrfStore.Unlock()
	now := time.Now()
	for token, expiry := range csrfStore.tokens {
		if now.After(expiry) {
			delete(csrfStore.tokens, token)
		}
	}
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'; script-src 'none'; style-src 'unsafe-inline'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	return c.Next()
}

type MessageInput struct {
	Content   string `json:"content"`
	Username  string `json:"username"`
	CSRFToken string `json:"csrf_token"`
}

func main() {
	initDB()
	defer func() {
		if db != nil {
			db.Close()
		}
	}()

	// Periodic cleanup of expired CSRF tokens
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanupCSRFTokens()
		}
	}()

	_ = os.Getenv("APP_SECRET")

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			c.Set("Content-Type", "text/plain")
			return c.Status(code).SendString(http.StatusText(code))
		},
	})

	app.Use(securityHeaders)

	app.Get("/csrf-token", func(c *fiber.Ctx) error {
		token, err := generateCSRFToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		return c.JSON(fiber.Map{"csrf_token": token})
	})

	app.Get("/messages", func(c *fiber.Ctx) error {
		limitStr := c.Query("limit", "10")
		offsetStr := c.Query("offset", "0")
		sort := strings.ToUpper(c.Query("sort", "DESC"))

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

		if sort != "ASC" && sort != "DESC" {
			sort = "DESC"
		}

		query := fmt.Sprintf("SELECT username, content, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
		rows, err := db.Query(query, limit, offset)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		defer rows.Close()

		csrfToken, err := generateCSRFToken()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		var htmlBuilder strings.Builder
		htmlBuilder.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MyForum</title>
<style>
body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
.message { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
.username { font-weight: bold; color: #333; }
.time { color: #999; font-size: 0.8em; }
.content { margin-top: 5px; }
form { margin-bottom: 20px; }
input, textarea { display: block; margin: 5px 0; padding: 5px; width: 100%; box-sizing: border-box; }
button { padding: 10px 20px; cursor: pointer; }
</style>
</head>
<body>
<h1>MyForum</h1>
<h2>Post a Message</h2>
<form id="messageForm">
<input type="hidden" name="csrf_token" id="csrf_token" value="` + html.EscapeString(csrfToken) + `">
<label for="username">Username:</label>
<input type="text" name="username" id="username" required maxlength="100">
<label for="content">Message:</label>
<textarea name="content" id="content" required maxlength="5000" rows="4"></textarea>
<button type="submit">Post</button>
</form>
<h2>Messages</h2>
<div id="messages">`)

		for rows.Next() {
			var username, content, createdAt string
			if err := rows.Scan(&username, &content, &createdAt); err != nil {
				continue
			}
			htmlBuilder.WriteString(`<div class="message">`)
			htmlBuilder.WriteString(`<span class="username">`)
			htmlBuilder.WriteString(html.EscapeString(username))
			htmlBuilder.WriteString(`</span>`)
			htmlBuilder.WriteString(` <span class="time">`)
			htmlBuilder.WriteString(html.EscapeString(createdAt))
			htmlBuilder.WriteString(`</span>`)
			htmlBuilder.WriteString(`<div class="content">`)
			htmlBuilder.WriteString(html.EscapeString(content))
			htmlBuilder.WriteString(`</div></div>`)
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		htmlBuilder.WriteString(`</div>
<script>
document.getElementById('messageForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var data = {
        username: document.getElementById('username').value,
        content: document.getElementById('content').value,
        csrf_token: document.getElementById('csrf_token').value
    };
    fetch('/messages', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    }).then(function(response) {
        if (response.ok) {
            window.location.reload();
        } else {
            response.text().then(function(t) { alert('Error: ' + t); });
        }
    });
});
</script>
</body>
</html>`)

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(htmlBuilder.String())
	})

	app.Post("/messages", func(c *fiber.Ctx) error {
		var msg MessageInput
		if err := c.BodyParser(&msg); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		// Validate CSRF token
		if !validateCSRFToken(msg.CSRFToken) {
			return c.Status(fiber.StatusForbidden).SendString("Invalid or missing CSRF token")
		}

		// Validate input
		msg.Content = strings.TrimSpace(msg.Content)
		msg.Username = strings.TrimSpace(msg.Username)

		if msg.Content == "" || msg.Username == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: username and content are required")
		}

		if len(msg.Username) > 100 {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: username too long")
		}

		if len(msg.Content) > 5000 {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: content too long")
		}

		// Use parameterized query to prevent SQL injection
		_, err := db.Exec("INSERT INTO messages (username, content) VALUES (?, ?)", msg.Username, msg.Content)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}

		return c.SendString("Message posted successfully")
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}