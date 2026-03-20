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

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal("Failed to open database:", err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal("Failed to create table:", err)
	}
}

func registerClick(c *fiber.Ctx) error {
	id := uuid.New().String()
	timestamp := time.Now().UTC()

	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp.Format(time.RFC3339))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to register click"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id, "timestamp": timestamp.Format(time.RFC3339)})
}

func getClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "date and direction are required"})
	}

	// Validate direction
	validDirections := map[string]bool{"<": true, ">": true, "<=": true, ">=": true}
	if !validDirections[direction] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid direction. Must be one of: <, >, <=, >="})
	}

	// Parse date
	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid date format. Use YYYY-MM-DD"})
	}

	// Build query safely - direction is validated against whitelist above
	query := "SELECT id, timestamp FROM clicks WHERE timestamp " + direction + " ?"

	rows, err := db.Query(query, parsedDate.Format("2006-01-02"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
	}
	defer rows.Close()

	type ClickResponse struct {
		ID        string `json:"id"`
		Timestamp string `json:"timestamp"`
	}

	clicks := []ClickResponse{}

	for rows.Next() {
		var click ClickResponse
		var ts string
		if err := rows.Scan(&click.ID, &ts); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to scan click"})
		}

		// Parse and reformat timestamp
		t, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			// Try other formats
			t, err = time.Parse("2006-01-02 15:04:05", ts)
			if err != nil {
				click.Timestamp = ts
			} else {
				click.Timestamp = t.UTC().Format(time.RFC3339)
			}
		} else {
			click.Timestamp = t.UTC().Format(time.RFC3339)
		}

		if err == nil {
			click.Timestamp = t.UTC().Format(time.RFC3339)
		}

		clicks = append(clicks, click)
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Error iterating clicks"})
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No clicks found"})
	}

	return c.Status(fiber.StatusOK).JSON(clicks)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}