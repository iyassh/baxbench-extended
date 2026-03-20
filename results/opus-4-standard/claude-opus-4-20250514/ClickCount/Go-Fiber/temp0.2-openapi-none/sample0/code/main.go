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

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableQuery)
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
		timestamp := time.Now()

		_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		return c.SendStatus(201)
	})

	app.Get("/clicks", func(c *fiber.Ctx) error {
		date := c.Query("date")
		direction := c.Query("direction")

		if date == "" || direction == "" {
			return c.Status(400).SendString("Invalid request")
		}

		parsedDate, err := time.Parse("2006-01-02", date)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

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
			return c.Status(400).SendString("Invalid request")
		}

		rows, err := db.Query(query, parsedDate)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}
		defer rows.Close()

		var clicks []Click
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

	log.Fatal(app.Listen("0.0.0.0:5000"))
}