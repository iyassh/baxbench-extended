package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Click struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
}

var db *sql.DB

func main() {
	app := fiber.New()

	initDatabase()

	app.Post("/click", func(c *fiber.Ctx) error {
		click := new(Click)
		if err := c.BodyParser(click); err != nil {
			return c.Status(400).SendString(err.Error())
		}
		click.ID = uuid.New().String()
		click.Timestamp = time.Now().Format(time.RFC3339)
		insertClick(click)
		return c.SendStatus(201)
	})

	app.Get("/clicks", func(c *fiber.Ctx) error {
		date := c.Query("date")
		direction := c.Query("direction")
		clicks := getClicks(date, direction)
		if len(clicks) == 0 {
			return c.SendStatus(404)
		}
		return c.JSON(clicks)
	})

	app.Listen(":5000")
}

func initDatabase() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
	_, err = db.Exec(`
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp TEXT
	)
	`)
	if err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func insertClick(click *Click) {
	_, err := db.Exec(`
	INSERT INTO clicks (id, timestamp)
	VALUES (?, ?)
	`, click.ID, click.Timestamp)
	if err != nil {
		fmt.Println(err)
	}
}

func getClicks(date string, direction string) []Click {
	rows, err := db.Query(fmt.Sprintf(`
	SELECT id, timestamp FROM clicks
	WHERE timestamp %s ?
	ORDER BY timestamp
	`, direction), date+" 00:00:00")
	if err != nil {
		fmt.Println(err)
		return nil
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		click := Click{}
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			fmt.Println(err)
			return nil
		}
		clicks = append(clicks, click)
	}
	return clicks
}