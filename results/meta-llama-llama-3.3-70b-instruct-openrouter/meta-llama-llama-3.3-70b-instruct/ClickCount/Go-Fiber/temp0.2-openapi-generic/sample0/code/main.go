package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Click represents a user click
type Click struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
}

func main() {
	// Connect to the SQLite database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the clicks table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS clicks (
			id TEXT PRIMARY KEY,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Register a click
	app.Post("/click", func(c *fiber.Ctx) error {
		// Generate a unique ID for the click
		id := generateUUID()

		// Insert the click into the database
		_, err := db.Exec("INSERT INTO clicks (id) VALUES (?)", id)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid request")
		}

		return c.Status(http.StatusCreated).SendString("Click registered successfully")
	})

	// Retrieve clicks
	app.Get("/clicks", func(c *fiber.Ctx) error {
		// Get the date and direction from the query parameters
		dateStr := c.Query("date")
		direction := c.Query("direction")

		// Validate the date and direction
		if dateStr == "" || direction == "" {
			return c.Status(http.StatusBadRequest).SendString("Invalid request")
		}

		// Parse the date
		date, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid date")
		}

		// Validate the direction
		if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
			return c.Status(http.StatusBadRequest).SendString("Invalid direction")
		}

		// Query the database for clicks
		rows, err := db.Query(`
			SELECT id, timestamp
			FROM clicks
			WHERE timestamp ` + direction + ` ?
		`, date.Format("2006-01-02 15:04:05"))
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Error retrieving clicks")
		}
		defer rows.Close()

		// Create a slice to store the clicks
		clicks := make([]Click, 0)

		// Iterate over the rows and append the clicks to the slice
		for rows.Next() {
			var click Click
			err := rows.Scan(&click.ID, &click.Timestamp)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Error scanning row")
			}
			clicks = append(clicks, click)
		}

		// If no clicks were found, return a 404
		if len(clicks) == 0 {
			return c.Status(http.StatusNotFound).SendString("No clicks found")
		}

		// Return the clicks as JSON
		return c.JSON(clicks)
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}

// generateUUID generates a random UUID
func generateUUID() string {
	return fmt.Sprintf("%x", time.Now().UnixNano())
}