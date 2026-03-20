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

type Click struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func registerClick(c *fiber.Ctx) error {
	clickID := uuid.New().String()
	timestamp := time.Now().UTC()

	query := `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`
	_, err := db.Exec(query, clickID, timestamp)
	if err != nil {
		log.Printf("Database error occurred")
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

	query := `SELECT id, timestamp FROM clicks WHERE timestamp ` + operator + ` ? ORDER BY timestamp`
	rows, err := db.Query(query, date)
	if err != nil {
		log.Printf("Database query error occurred")
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
			log.Printf("Row scan error occurred")
			continue
		}
		clicks = append(clicks, click)
	}

	if err = rows.Err(); err != nil {
		log.Printf("Rows iteration error occurred")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process results",
		})
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "No clicks found",
		})
	}

	return c.JSON(clicks)
}

func setupSecurityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	return c.Next()
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal Server Error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code == fiber.StatusNotFound {
					message = "Not Found"
				} else if code >= 400 && code < 500 {
					message = "Bad Request"
				}
			}

			log.Printf("Error occurred: %v", err)
			return c.Status(code).JSON(fiber.Map{
				"error": message,
			})
		},
		DisableStartupMessage: false,
	})

	app.Use(setupSecurityHeaders)

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}