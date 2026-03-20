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
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

type Message struct {
	ID        int       `json:"id"`
	Content   string    `json:"content"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

type MessageRequest struct {
	Content  string `json:"content"`
	Username string `json:"username"`
}

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return nil, err
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
		return nil, err
	}

	return db, nil
}

func validateMessage(msg MessageRequest) error {
	if strings.TrimSpace(msg.Content) == "" {
		return fmt.Errorf("content cannot be empty")
	}
	if strings.TrimSpace(msg.Username) == "" {
		return fmt.Errorf("username cannot be empty")
	}
	if len(msg.Content) > 1000 {
		return fmt.Errorf("content too long")
	}
	if len(msg.Username) > 50 {
		return fmt.Errorf("username too long")
	}
	return nil
}

func main() {
	db, err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST",
		AllowHeaders: "Origin, Content-Type, Accept",
	}))

	app.Use(recover.New())

	app.Get("/messages", func(c *fiber.Ctx) error {
		limitStr := c.Query("limit", "10")
		offsetStr := c.Query("offset", "0")
		sort := c.Query("sort", "DESC")

		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit < 1 || limit > 100 {
			limit = 10
		}

		offset, err := strconv.Atoi(offsetStr)
		if err != nil || offset < 0 {
			offset = 0
		}

		if sort != "ASC" && sort != "DESC" {
			sort = "DESC"
		}

		query := fmt.Sprintf("SELECT id, content, username, created_at FROM messages ORDER BY created_at %s LIMIT ? OFFSET ?", sort)
		rows, err := db.Query(query, limit, offset)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		defer rows.Close()

		var messages []Message
		for rows.Next() {
			var msg Message
			err := rows.Scan(&msg.ID, &msg.Content, &msg.Username, &msg.CreatedAt)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Database error"})
			}
			messages = append(messages, msg)
		}

		if err = rows.Err(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}

		var htmlBuilder strings.Builder
		htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>MyForum</title></head><body>")
		htmlBuilder.WriteString("<h1>Forum Messages</h1>")
		
		if len(messages) == 0 {
			htmlBuilder.WriteString("<p>No messages found.</p>")
		} else {
			for _, msg := range messages {
				htmlBuilder.WriteString("<div style='border: 1px solid #ccc; margin: 10px; padding: 10px;'>")
				htmlBuilder.WriteString(fmt.Sprintf("<strong>%s</strong> - %s<br>", 
					html.EscapeString(msg.Username), 
					msg.CreatedAt.Format("2006-01-02 15:04:05")))
				htmlBuilder.WriteString(fmt.Sprintf("<p>%s</p>", html.EscapeString(msg.Content)))
				htmlBuilder.WriteString("</div>")
			}
		}
		
		htmlBuilder.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.SendString(htmlBuilder.String())
	})

	app.Post("/messages", func(c *fiber.Ctx) error {
		var msgReq MessageRequest
		
		if err := json.Unmarshal(c.Body(), &msgReq); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if err := validateMessage(msgReq); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		_, err := db.Exec("INSERT INTO messages (content, username) VALUES (?, ?)", 
			msgReq.Content, msgReq.Username)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}

		return c.JSON(fiber.Map{"message": "Message posted successfully"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}