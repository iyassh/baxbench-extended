package main

import (
	"database/sql"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp TEXT NOT NULL
	)`)
	if err != nil {
		panic(err)
	}

	app := fiber.New()

	app.Post("/click", func(c *fiber.Ctx) error {
		id := uuid.New().String()
		timestamp := time.Now().UTC().Format(time.RFC3339)

		_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		return c.SendStatus(fiber.StatusCreated)
	})

	app.Get("/clicks", func(c *fiber.Ctx) error {
		dateStr := c.Query("date")
		direction := c.Query("direction")

		if dateStr == "" || direction == "" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// Validate date format
		_, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// Validate direction
		if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// For date comparison, we need to handle the date boundary properly
		var query string
		var queryDate string

		switch direction {
		case "<":
			query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
			queryDate = dateStr + "T00:00:00Z"
		case "<=":
			query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
			queryDate = dateStr + "T00:00:00Z"
			// <= date means before the end of that day
			t, _ := time.Parse("2006-01-02", dateStr)
			t = t.AddDate(0, 0, 1)
			queryDate = t.Format("2006-01-02") + "T00:00:00Z"
		case ">":
			query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
			t, _ := time.Parse("2006-01-02", dateStr)
			t = t.AddDate(0, 0, 1)
			queryDate = t.Format("2006-01-02") + "T00:00:00Z"
		case ">=":
			query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
			queryDate = dateStr + "T00:00:00Z"
		}

		rows, err := db.Query(query, queryDate)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		defer rows.Close()

		type ClickResponse struct {
			ID        string `json:"id"`
			Timestamp string `json:"timestamp"`
		}

		var clicks []ClickResponse
		for rows.Next() {
			var click ClickResponse
			if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
				return c.SendStatus(fiber.StatusBadRequest)
			}
			clicks = append(clicks, click)
		}

		if len(clicks) == 0 {
			return c.SendStatus(fiber.StatusNotFound)
		}

		return c.Status(fiber.StatusOK).JSON(clicks)
	})

	app.Listen("0.0.0.0:5000")
}