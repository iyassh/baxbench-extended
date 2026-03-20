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

	createTableSQL := `CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

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
		return c.Next()
	})

	app.Post("/click", handlePostClick)
	app.Get("/clicks", handleGetClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handlePostClick(c *fiber.Ctx) error {
	id := uuid.New().String()
	timestamp := time.Now().UTC().Format(time.RFC3339)

	stmt, err := db.Prepare("INSERT INTO clicks (id, timestamp) VALUES (?, ?)")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(id, timestamp)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Click registered successfully"})
}

func handleGetClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required parameters: date and direction"})
	}

	// Validate date format
	_, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid date format. Expected YYYY-MM-DD"})
	}

	// Validate direction to prevent SQL injection
	var operator string
	switch direction {
	case "<":
		operator = "<"
	case ">":
		operator = ">"
	case "<=":
		operator = "<="
	case ">=":
		operator = ">="
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid direction. Must be one of: <, >, <=, >="})
	}

	// Use parameterized query with validated operator
	query := "SELECT id, timestamp FROM clicks WHERE timestamp " + operator + " ?"

	rows, err := db.Query(query, dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}
	defer rows.Close()

	type Click struct {
		ID        string `json:"id"`
		Timestamp string `json:"timestamp"`
	}

	var clicks []Click
	for rows.Next() {
		var click Click
		if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}
		clicks = append(clicks, click)
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No clicks found"})
	}

	return c.Status(fiber.StatusOK).JSON(clicks)
}