package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Click struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
}

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);
	`

	if _, err := db.Exec(createTableSQL); err != nil {
		log.Fatalf("Failed to create table: %v", err)
	}
}

func registerClick(c *fiber.Ctx) error {
	clickID := uuid.New().String()
	timestamp := time.Now().UTC()

	insertSQL := `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`
	_, err := db.Exec(insertSQL, clickID, timestamp)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to register click",
		})
	}

	return c.Status(http.StatusCreated).JSON(fiber.Map{
		"id":        clickID,
		"timestamp": timestamp,
	})
}

func retrieveClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing required parameters: date and direction",
		})
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid date format. Use YYYY-MM-DD",
		})
	}

	validDirections := map[string]bool{
		"<":  true,
		">":  true,
		"<=": true,
		">=": true,
	}

	if !validDirections[direction] {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid direction. Use <, >, <=, or >=",
		})
	}

	query := fmt.Sprintf(`SELECT id, timestamp FROM clicks WHERE timestamp %s ? ORDER BY timestamp DESC`, direction)
	rows, err := db.Query(query, parsedDate)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to retrieve clicks",
		})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to parse click data",
			})
		}
		clicks = append(clicks, click)
	}

	if err := rows.Err(); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Error reading results",
		})
	}

	if len(clicks) == 0 {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "No clicks found",
		})
	}

	return c.Status(http.StatusOK).JSON(clicks)
}

func main() {
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,OPTIONS",
		AllowHeaders: "Content-Type",
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/click", registerClick)
	app.Get("/clicks", retrieveClicks)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}