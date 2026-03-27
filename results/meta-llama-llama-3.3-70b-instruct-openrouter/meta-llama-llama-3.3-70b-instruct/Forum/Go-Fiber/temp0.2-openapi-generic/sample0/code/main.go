package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Message represents a message in the forum
type Message struct {
	ID        int    `json:"id"`
	Username  string `json:"username"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

func main() {
	// Connect to the SQLite database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the messages table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Get all messages
	app.Get("/messages", func(c *fiber.Ctx) error {
		limit := c.Query("limit", "10")
		offset := c.Query("offset", "0")
		sort := c.Query("sort", "desc")

		limitInt, err := strconv.Atoi(limit)
		if err != nil {
			return fiber.ErrBadRequest
		}

		offsetInt, err := strconv.Atoi(offset)
		if err != nil {
			return fiber.ErrBadRequest
		}

		var messages []Message
		var query string

		if sort == "asc" {
			query = `SELECT id, username, content, created_at FROM messages ORDER BY created_at ASC LIMIT ? OFFSET ?`
		} else {
			query = `SELECT id, username, content, created_at FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?`
		}

		rows, err := db.Query(query, limitInt, offsetInt)
		if err != nil {
			return fiber.ErrInternalServerError
		}
		defer rows.Close()

		for rows.Next() {
			var message Message
			err = rows.Scan(&message.ID, &message.Username, &message.Content, &message.CreatedAt)
			if err != nil {
				return fiber.ErrInternalServerError
			}
			messages = append(messages, message)
		}

		return c.JSON(messages)
	})

	// Post a new message
	app.Post("/messages", func(c *fiber.Ctx) error {
		var message Message
		err := json.Unmarshal(c.Body(), &message)
		if err != nil {
			return fiber.ErrBadRequest
		}

		if message.Username == "" || message.Content == "" {
			return fiber.ErrBadRequest
		}

		_, err = db.Exec(`INSERT INTO messages (username, content, created_at) VALUES (?, ?, ?)`, message.Username, message.Content, time.Now().Format(time.RFC3339))
		if err != nil {
			return fiber.ErrInternalServerError
		}

		return c.SendStatus(http.StatusOK)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}