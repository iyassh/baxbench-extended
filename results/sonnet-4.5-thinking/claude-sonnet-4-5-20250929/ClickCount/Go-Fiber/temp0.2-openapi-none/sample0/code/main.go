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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func registerClick(c *fiber.Ctx) error {
	click := Click{
		ID:        uuid.New().String(),
		Timestamp: time.Now(),
	}

	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", click.ID, click.Timestamp)
	if err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	return c.SendStatus(201)
}

func getClicks(c *fiber.Ctx) error {
	date := c.Query("date")
	direction := c.Query("direction")

	if date == "" || direction == "" {
		return c.Status(400).SendString("Invalid request")
	}

	if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
		return c.Status(400).SendString("Invalid request")
	}

	parsedDate, err := time.Parse("2006-01-02", date)
	if err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	query := "SELECT id, timestamp FROM clicks WHERE DATE(timestamp) " + direction + " ?"
	rows, err := db.Query(query, parsedDate.Format("2006-01-02"))
	if err != nil {
		return c.Status(400).SendString("Invalid request")
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
			return c.Status(400).SendString("Invalid request")
		}
		clicks = append(clicks, click)
	}

	if len(clicks) == 0 {
		return c.Status(404).SendString("No clicks found")
	}

	return c.JSON(clicks)
}