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

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableQuery)
	return err
}

func registerClick(c *fiber.Ctx) error {
	id := uuid.New().String()
	timestamp := time.Now()

	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to register click",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Click registered successfully",
		"id":      id,
	})
}

func getClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing required parameters: date and direction",
		})
	}

	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid date format. Use YYYY-MM-DD",
		})
	}

	var operator string
	switch direction {
	case "<", ">", "<=", ">=":
		operator = direction
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid direction. Use <, >, <=, or >=",
		})
	}

	query := "SELECT id, timestamp FROM clicks WHERE timestamp " + operator + " ?"
	rows, err := db.Query(query, date)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database query failed",
		})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			continue
		}
		clicks = append(clicks, click)
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "No clicks found",
		})
	}

	return c.JSON(clicks)
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}