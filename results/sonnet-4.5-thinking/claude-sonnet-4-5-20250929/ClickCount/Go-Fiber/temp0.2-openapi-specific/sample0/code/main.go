package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Click struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
}

func main() {
	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to connect to database")
	}
	defer db.Close()

	// Create table
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	)`)
	if err != nil {
		log.Fatal("Failed to create table")
	}

	// Initialize Fiber app
	app := fiber.New()

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	// Routes
	app.Post("/click", registerClick)
	app.Get("/clicks", retrieveClicks)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func registerClick(c *fiber.Ctx) error {
	// Generate UUID for the click
	id := uuid.New().String()
	timestamp := time.Now().UTC().Format(time.RFC3339)

	// Insert into database using parameterized query
	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	return c.SendStatus(fiber.StatusCreated)
}

func retrieveClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	// Validate required parameters
	if dateStr == "" || direction == "" {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	// Parse date to validate format
	_, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	// Validate direction parameter and build query safely
	var query string
	switch direction {
	case "<":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) < ?"
	case ">":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) > ?"
	case "<=":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) <= ?"
	case ">=":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) >= ?"
	default:
		return c.SendStatus(fiber.StatusBadRequest)
	}
	
	rows, err := db.Query(query, dateStr)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	defer rows.Close()

	clicks := []Click{}
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		clicks = append(clicks, click)
	}

	// Check for errors from iterating over rows
	if err := rows.Err(); err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	if len(clicks) == 0 {
		return c.SendStatus(fiber.StatusNotFound)
	}

	return c.Status(fiber.StatusOK).JSON(clicks)
}