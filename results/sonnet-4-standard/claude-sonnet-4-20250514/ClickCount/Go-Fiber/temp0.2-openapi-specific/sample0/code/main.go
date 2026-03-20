package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Click struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	db, err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(ErrorResponse{Error: "Internal server error"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))
	app.Use(recover.New())

	app.Post("/click", func(c *fiber.Ctx) error {
		return registerClick(c, db)
	})

	app.Get("/clicks", func(c *fiber.Ctx) error {
		return getClicks(c, db)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return nil, err
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS clicks (
		id TEXT PRIMARY KEY,
		timestamp DATETIME NOT NULL
	);`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		return nil, err
	}

	return db, nil
}

func registerClick(c *fiber.Ctx, db *sql.DB) error {
	clickID := uuid.New().String()
	timestamp := time.Now().UTC()

	stmt, err := db.Prepare("INSERT INTO clicks (id, timestamp) VALUES (?, ?)")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(clickID, timestamp)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}

	return c.SendStatus(fiber.StatusCreated)
}

func getClicks(c *fiber.Ctx, db *sql.DB) error {
	dateStr := c.Query("date")
	direction := c.Query("direction")

	if dateStr == "" || direction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Missing required parameters"})
	}

	if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid direction parameter"})
	}

	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid date format"})
	}

	query := "SELECT id, timestamp FROM clicks WHERE timestamp " + direction + " ?"
	stmt, err := db.Prepare(query)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}
	defer stmt.Close()

	rows, err := stmt.Query(date)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}
	defer rows.Close()

	var clicks []Click
	for rows.Next() {
		var click Click
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
		}
		clicks = append(clicks, click)
	}

	if err = rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Internal server error"})
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{Error: "No clicks found"})
	}

	return c.JSON(clicks)
}