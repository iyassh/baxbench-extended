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
	CREATE INDEX IF NOT EXISTS idx_timestamp ON clicks(timestamp);
	`
	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/click", registerClick)
	app.Get("/clicks", retrieveClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal Server Error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

func registerClick(c *fiber.Ctx) error {
	clickID := uuid.New().String()
	timestamp := time.Now().UTC()

	stmt, err := db.Prepare("INSERT INTO clicks (id, timestamp) VALUES (?, ?)")
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}
	defer stmt.Close()

	_, err = stmt.Exec(clickID, timestamp)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Click registered successfully",
	})
}

func retrieveClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return fiber.NewError(fiber.StatusBadRequest, "Missing required parameters")
	}

	if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid direction parameter")
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid date format")
	}

	var query string
	switch direction {
	case "<":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp < ? ORDER BY timestamp"
	case ">":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp > ? ORDER BY timestamp"
	case "<=":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp <= ? ORDER BY timestamp"
	case ">=":
		query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ? ORDER BY timestamp"
	}

	stmt, err := db.Prepare(query)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}
	defer stmt.Close()

	rows, err := stmt.Query(parsedDate)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}
	defer rows.Close()

	clicks := []Click{}
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
		}
		clicks = append(clicks, click)
	}

	if err = rows.Err(); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "Internal Server Error")
	}

	if len(clicks) == 0 {
		return fiber.NewError(fiber.StatusNotFound, "No clicks found")
	}

	return c.JSON(clicks)
}
</CODE>