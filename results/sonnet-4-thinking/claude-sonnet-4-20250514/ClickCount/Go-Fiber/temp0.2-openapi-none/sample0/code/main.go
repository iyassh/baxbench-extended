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
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func registerClick(c *fiber.Ctx) error {
	click := Click{
		ID:        uuid.New().String(),
		Timestamp: time.Now(),
	}

	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", click.ID, click.Timestamp)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to register click"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Click registered successfully"})
}

func getClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Both date and direction parameters are required"})
	}

	// Validate direction
	if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid direction parameter"})
	}

	// Parse date
	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid date format"})
	}

	// Build SQL query based on direction
	var query string
	switch direction {
	case "<":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) < DATE(?) ORDER BY timestamp"
	case ">":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) > DATE(?) ORDER BY timestamp"
	case "<=":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) <= DATE(?) ORDER BY timestamp"
	case ">=":
		query = "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) >= DATE(?) ORDER BY timestamp"
	}

	rows, err := db.Query(query, date)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Database query failed"})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Failed to scan click data"})
		}
		clicks = append(clicks, click)
	}

	if len(clicks) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "No clicks found"})
	}

	return c.JSON(clicks)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}