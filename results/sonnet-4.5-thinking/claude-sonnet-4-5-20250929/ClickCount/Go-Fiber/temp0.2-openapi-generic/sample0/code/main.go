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
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS clicks (
			id TEXT PRIMARY KEY,
			timestamp TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Initialize Fiber app
	app := fiber.New()

	// POST /click
	app.Post("/click", func(c *fiber.Ctx) error {
		click := Click{
			ID:        uuid.New().String(),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}

		_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", click.ID, click.Timestamp)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		return c.SendStatus(201)
	})

	// GET /clicks
	app.Get("/clicks", func(c *fiber.Ctx) error {
		dateStr := c.Query("date")
		direction := c.Query("direction")

		if dateStr == "" || direction == "" {
			return c.Status(400).SendString("Invalid request")
		}

		// Validate direction
		validDirections := map[string]bool{"<": true, ">": true, "<=": true, ">=": true}
		if !validDirections[direction] {
			return c.Status(400).SendString("Invalid request")
		}

		// Parse date to validate format
		_, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		// Build query safely
		query := "SELECT id, timestamp FROM clicks WHERE date(timestamp) " + direction + " date(?)"
		rows, err := db.Query(query, dateStr)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}
		defer rows.Close()

		clicks := []Click{}
		for rows.Next() {
			var click Click
			err := rows.Scan(&click.ID, &click.Timestamp)
			if err != nil {
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