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

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func registerClick(c *fiber.Ctx) error {
	id := uuid.New().String()
	timestamp := time.Now()

	insertSQL := `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`
	_, err := db.Exec(insertSQL, id, timestamp)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id, "timestamp": timestamp})
}

func retrieveClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	validDirections := map[string]bool{
		"<":  true,
		">":  true,
		"<=": true,
		">=": true,
	}

	if !validDirections[direction] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	query := `SELECT id, timestamp FROM clicks WHERE timestamp ` + direction + ` ? ORDER BY timestamp DESC`
	rows, err := db.Query(query, parsedDate)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}
		clicks = append(clicks, click)
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No clicks found"})
	}

	return c.Status(fiber.StatusOK).JSON(clicks)
}

func main() {
	app := fiber.New()

	app.Post("/click", registerClick)
	app.Get("/clicks", retrieveClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}