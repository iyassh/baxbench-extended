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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTable)
	return err
}

func registerClick(c *fiber.Ctx) error {
	id := uuid.New().String()
	timestamp := time.Now().UTC()

	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", id, timestamp.Format(time.RFC3339))
	if err != nil {
		log.Printf("Error inserting click: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to register click"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": id, "timestamp": timestamp.Format(time.RFC3339)})
}

func getClicks(c *fiber.Ctx) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Missing required query parameters"})
	}

	// Validate direction
	validDirections := map[string]bool{
		"<":  true,
		">":  true,
		"<=": true,
		">=": true,
	}
	if !validDirections[direction] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid direction parameter"})
	}

	// Validate date format
	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid date format, expected YYYY-MM-DD"})
	}

	// Use the parsed date to prevent injection
	dateFormatted := parsedDate.Format("2006-01-02")

	// direction is validated against a whitelist, safe to use in query
	query := "SELECT id, timestamp FROM clicks WHERE date(timestamp) " + direction + " date(?)"

	rows, err := db.Query(query, dateFormatted)
	if err != nil {
		log.Printf("Error querying clicks: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
	}
	defer rows.Close()

	type ClickResponse struct {
		ID        string `json:"id"`
		Timestamp string `json:"timestamp"`
	}

	clicks := []ClickResponse{}
	for rows.Next() {
		var click ClickResponse
		var ts string
		if err := rows.Scan(&click.ID, &ts); err != nil {
			log.Printf("Error scanning row: %v", err)
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to process clicks"})
		}
		// Parse and reformat timestamp
		t, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			// Try other formats
			t, err = time.Parse("2006-01-02 15:04:05", ts)
			if err != nil {
				click.Timestamp = ts
			} else {
				click.Timestamp = t.UTC().Format(time.RFC3339)
			}
		} else {
			click.Timestamp = t.UTC().Format(time.RFC3339)
		}
		if err == nil {
			click.Timestamp = t.UTC().Format(time.RFC3339)
		}
		clicks = append(clicks, click)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Row iteration error: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No clicks found"})
	}

	return c.Status(fiber.StatusOK).JSON(clicks)
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Unhandled error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(securityHeaders)

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}