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
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/click", func(c *fiber.Ctx) error {
		id := uuid.New().String()
		timestamp := time.Now().UTC().Format(time.RFC3339)

		_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to register click"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Click registered successfully"})
	})

	app.Get("/clicks", func(c *fiber.Ctx) error {
		dateStr := c.Query("date")
		direction := c.Query("direction")

		if dateStr == "" || direction == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "date and direction query parameters are required"})
		}

		// Validate date format
		parsedDate, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid date format. Use YYYY-MM-DD"})
		}

		// Validate direction
		validDirections := map[string]bool{
			"<":  true,
			">":  true,
			"<=": true,
			">=": true,
		}
		if !validDirections[direction] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid direction. Use <, >, <=, or >="})
		}

		// For date comparison, we need to handle the boundary correctly
		var query string
		var compareDate string

		switch direction {
		case "<":
			compareDate = parsedDate.Format("2006-01-02T00:00:00Z")
			query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
		case "<=":
			// Include the entire day
			compareDate = parsedDate.AddDate(0, 0, 1).Format("2006-01-02T00:00:00Z")
			query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
		case ">":
			// After the entire day
			compareDate = parsedDate.AddDate(0, 0, 1).Format("2006-01-02T00:00:00Z")
			query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
		case ">=":
			compareDate = parsedDate.Format("2006-01-02T00:00:00Z")
			query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
		}

		rows, err := db.Query(query, compareDate)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
		}
		defer rows.Close()

		type Click struct {
			ID        string `json:"id"`
			Timestamp string `json:"timestamp"`
		}

		var clicks []Click
		for rows.Next() {
			var click Click
			if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to scan click"})
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
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}