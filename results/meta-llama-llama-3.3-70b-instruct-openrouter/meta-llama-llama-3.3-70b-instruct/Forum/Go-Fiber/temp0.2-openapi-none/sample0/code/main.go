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
		limit := 10
		offset := 0
		sort := "DESC"

		// Parse query parameters
		if limitStr := c.Query("limit"); limitStr != "" {
			limit, err = strconv.Atoi(limitStr)
			if err != nil {
				return c.Status(http.StatusBadRequest).SendString("Invalid limit")
			}
		}
		if offsetStr := c.Query("offset"); offsetStr != "" {
			offset, err = strconv.Atoi(offsetStr)
			if err != nil {
				return c.Status(http.StatusBadRequest).SendString("Invalid offset")
			}
		}
		if sortStr := c.Query("sort"); sortStr != "" {
			sort = strings.ToUpper(sortStr)
			if sort != "ASC" && sort != "DESC" {
				return c.Status(http.StatusBadRequest).SendString("Invalid sort")
			}
		}

		// Query the database
		rows, err := db.Query(`
			SELECT id, username, content, created_at
			FROM messages
			ORDER BY created_at ` + sort + `
			LIMIT ? OFFSET ?;
		`, limit, offset)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to query database")
		}
		defer rows.Close()

		// Marshal the results
		var messages []Message
		for rows.Next() {
			var message Message
			err = rows.Scan(&message.ID, &message.Username, &message.Content, &message.CreatedAt)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to scan row")
			}
			messages = append(messages, message)
		}

		// Return the results
		return c.JSON(messages)
	})

	// Post a new message
	app.Post("/messages", func(c *fiber.Ctx) error {
		// Parse the request body
		var message Message
		err := json.Unmarshal(c.Body(), &message)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid request body")
		}

		// Validate the message
		if message.Username == "" || message.Content == "" {
			return c.Status(http.StatusBadRequest).SendString("Invalid message")
		}

		// Insert the message into the database
		_, err = db.Exec(`
			INSERT INTO messages (username, content, created_at)
			VALUES (?, ?, ?);
		`, message.Username, message.Content, time.Now().Format(time.RFC3339))
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to insert message")
		}

		// Return a success response
		return c.SendStatus(http.StatusOK)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}