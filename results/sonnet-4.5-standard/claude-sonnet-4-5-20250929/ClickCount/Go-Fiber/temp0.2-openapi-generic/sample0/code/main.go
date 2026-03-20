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

var db *sql.DB

type Click struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func registerClick(c *fiber.Ctx) error {
	clickID := uuid.New().String()
	timestamp := time.Now().UTC()

	_, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", clickID, timestamp)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to register click",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Click registered successfully",
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

	if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid direction parameter",
		})
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid date format",
		})
	}

	query := "SELECT id, timestamp FROM clicks WHERE timestamp " + direction + " ?"
	rows, err := db.Query(query, parsedDate)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Failed to query clicks",
		})
	}
	defer rows.Close()

	clicks := []Click{}
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Failed to scan click",
			})
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
</CODE>