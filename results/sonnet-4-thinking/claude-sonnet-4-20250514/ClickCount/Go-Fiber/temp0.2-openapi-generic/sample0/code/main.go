package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Click struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
}

func main() {
	// Initialize database
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	createTableQuery := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	if _, err := db.Exec(createTableQuery); err != nil {
		log.Fatal(err)
	}

	// Initialize Fiber app
	app := fiber.New()

	// POST /click endpoint
	app.Post("/click", func(c *fiber.Ctx) error {
		// Generate UUID for click
		clickID := uuid.New().String()

		// Insert click into database
		query := "INSERT INTO clicks (id, timestamp) VALUES (?, ?)"
		timestamp := time.Now().UTC().Format(time.RFC3339)

		if _, err := db.Exec(query, clickID, timestamp); err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		return c.SendStatus(201)
	})

	// GET /clicks endpoint
	app.Get("/clicks", func(c *fiber.Ctx) error {
		// Get query parameters
		dateStr := c.Query("date")
		direction := c.Query("direction")

		if dateStr == "" || direction == "" {
			return c.Status(400).SendString("Invalid request")
		}

		// Parse and validate date
		_, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		// Validate direction and build query
		var query string
		switch direction {
		case "<":
			query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) < ?"
		case ">":
			query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) > ?"
		case "<=":
			query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) <= ?"
		case ">=":
			query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) >= ?"
		default:
			return c.Status(400).SendString("Invalid request")
		}

		rows, err := db.Query(query, dateStr)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}
		defer rows.Close()

		var clicks []Click
		for rows.Next() {
			var click Click
			if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
				return c.Status(400).SendString("Invalid request")
			}
			clicks = append(clicks, click)
		}

		if len(clicks) == 0 {
			return c.Status(404).SendString("No clicks found")
		}

		return c.JSON(clicks)
	})

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}