package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Click struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	)`

	_, err = db.Exec(createTableQuery)
	return err
}

func registerClick(c *fiber.Ctx) error {
	clickID := uuid.New().String()
	timestamp := time.Now().UTC()

	query := "INSERT INTO clicks (id, timestamp) VALUES (?, ?)"
	_, err := db.Exec(query, clickID, timestamp)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to register click"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Click registered successfully"})
}

func getClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Date and direction parameters are required"})
	}

	// Parse date first to validate format
	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid date format"})
	}

	// Build query safely based on direction
	var query string
	switch direction {
	case "<":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
	case ">":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp > ?"
	case "<=":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp <= ?"
	case ">=":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
	default:
		return c.Status(400).JSON(fiber.Map{"error": "Invalid direction parameter"})
	}
	
	rows, err := db.Query(query, parsedDate)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		var timestamp time.Time
		err := rows.Scan(&click.ID, &timestamp)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Failed to process clicks"})
		}
		click.Timestamp = timestamp.Format(time.RFC3339)
		clicks = append(clicks, click)
	}

	if len(clicks) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "No clicks found"})
	}

	return c.JSON(clicks)
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	// Add security headers
	app.Use(helmet.New())

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}