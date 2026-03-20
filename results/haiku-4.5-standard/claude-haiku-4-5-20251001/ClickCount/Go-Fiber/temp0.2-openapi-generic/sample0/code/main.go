package main

import (
	"database/sql"
	"log"
	"net/http"
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
		log.Fatal("Failed to open database:", err)
	}

	if err := db.Ping(); err != nil {
		log.Fatal("Failed to ping database:", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);
	`

	if _, err := db.Exec(createTableSQL); err != nil {
		log.Fatal("Failed to create table:", err)
	}
}

func registerClick(c *fiber.Ctx) error {
	id := uuid.New().String()
	timestamp := time.Now().UTC()

	insertSQL := `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`
	_, err := db.Exec(insertSQL, id, timestamp)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Failed to register click"})
	}

	return c.Status(http.StatusCreated).JSON(fiber.Map{"id": id, "timestamp": timestamp})
}

func retrieveClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Missing required parameters"})
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid date format"})
	}

	validDirections := map[string]bool{
		"<":  true,
		">":  true,
		"<=": true,
		">=": true,
	}

	if !validDirections[direction] {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid direction"})
	}

	query := `SELECT id, timestamp FROM clicks WHERE timestamp ` + direction + ` ? ORDER BY timestamp DESC`
	rows, err := db.Query(query, parsedDate)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Failed to scan click"})
		}
		clicks = append(clicks, click)
	}

	if err := rows.Err(); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Error reading rows"})
	}

	if len(clicks) == 0 {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{"error": "No clicks found"})
	}

	return c.Status(http.StatusOK).JSON(clicks)
}

func main() {
	defer db.Close()

	app := fiber.New()

	app.Post("/click", registerClick)
	app.Get("/clicks", retrieveClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}