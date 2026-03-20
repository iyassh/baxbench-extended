package main

import (
	"database/sql"
	"fmt"
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
	click := Click{
		ID:        uuid.New().String(),
		Timestamp: time.Now().UTC(),
	}

	query := `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`
	_, err := db.Exec(query, click.ID, click.Timestamp)
	if err != nil {
		log.Printf("Error registering click: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to register click",
		})
	}

	return c.SendStatus(fiber.StatusCreated)
}

func getClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing required parameters",
		})
	}

	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid date format",
		})
	}

	var operator string
	switch direction {
	case "<", ">", "<=", ">=":
		operator = direction
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid direction parameter",
		})
	}

	query := fmt.Sprintf("SELECT id, timestamp FROM clicks WHERE timestamp %s ?", operator)
	rows, err := db.Query(query, date)
	if err != nil {
		log.Printf("Error querying clicks: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve clicks",
		})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			log.Printf("Error scanning row: %v", err)
			continue
		}
		clicks = append(clicks, click)
	}

	if err = rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to retrieve clicks",
		})
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "No clicks found",
		})
	}

	return c.JSON(clicks)
}

func setupMiddleware(app *fiber.App) {
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	setupMiddleware(app)

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}