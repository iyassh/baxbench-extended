<CODE>
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

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTable := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);
	`
	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/click", registerClick)
	app.Get("/clicks", retrieveClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func registerClick(c *fiber.Ctx) error {
	clickID := uuid.New().String()
	timestamp := time.Now()

	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", clickID, timestamp)
	if err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	return c.Status(201).SendString("Click registered successfully")
}

func retrieveClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(400).SendString("Invalid request")
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
		return c.Status(400).SendString("Invalid request")
	}

	query := "SELECT id, timestamp FROM clicks WHERE timestamp " + direction + " ?"
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
}
</CODE>