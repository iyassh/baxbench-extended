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
		var op string
		switch direction {
		case "<":
			op = "<"
		case ">":
			op = ">"
		case "<=":
			op = "<="
		case ">=":
			op = ">="
		default:
			return c.SendStatus(fiber.StatusBadRequest)
		}

		query := "SELECT id, timestamp FROM clicks WHERE date(timestamp) " + op + " date(?)"
		rows, err := db.Query(query, dateStr)
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

		if err := rows.Err(); err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		if len(clicks) == 0 {
			return c.SendStatus(fiber.StatusNotFound)
		}

		return c.Status(fiber.StatusOK).JSON(clicks)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}