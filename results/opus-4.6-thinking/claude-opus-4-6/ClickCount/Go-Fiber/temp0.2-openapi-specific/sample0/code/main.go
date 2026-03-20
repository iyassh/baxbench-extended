package main

import (
	"database/sql"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp TEXT NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/click", func(c *fiber.Ctx) error {
		id := uuid.New().String()
		timestamp := time.Now().UTC().Format(time.RFC3339)

		_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to register click"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Click registered successfully"})
	})

	app.Get("/clicks", func(c *fiber.Ctx) error {
		dateStr := c.Query("date")
		direction := c.Query("direction")

		if dateStr == "" || direction == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required query parameters: date and direction"})
		}

		// Validate date format
		_, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid date format. Expected YYYY-MM-DD"})
		}

		// Validate direction - whitelist approach to prevent SQL injection
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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid direction. Must be one of: <, >, <=, >="})
		}

		// Build query with safe operator (whitelisted) and parameterized date
		query := "SELECT id, timestamp FROM clicks WHERE timestamp " + op + " ?"
		rows, err := db.Query(query, dateStr)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
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
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to process clicks"})
			}
			clicks = append(clicks, click)
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
		}

		if len(clicks) == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No clicks found"})
		}

		return c.Status(fiber.StatusOK).JSON(clicks)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}