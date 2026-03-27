package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
)

type Click struct {
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
}

var db *sql.DB

func main() {
	app := fiber.New()
	app.Use(logger.New())

	dbName := "db.sqlite3"
	var err error
	db, err = sql.Open("sqlite3", dbName)
	if err != nil {
		fmt.Println(err)
		return
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS clicks (
			id TEXT NOT NULL,
			timestamp TEXT
		);
	`)
	if err != nil {
		fmt.Println(err)
		return
	}

	app.Post("/click", registerClick)
	app.Get("/clicks", getClicks)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	err = app.Listen(":5000")
	if err != nil {
		fmt.Println(err)
		return
	}
}

func registerClick(c *fiber.Ctx) error {
	click := new(Click)
	if err := c.BodyParser(click); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString(err.Error())
	}

	_, err := db.Exec(`
		INSERT INTO clicks (id, timestamp)
		VALUES (?, ?)
	`, click.ID, click.Timestamp)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString(err.Error())
	}

	return c.SendStatus(fiber.StatusCreated)
}

func getClicks(c *fiber.Ctx) error {
	date := c.Query("date")
	direction := c.Query("direction")

	rows, err := db.Query(fmt.Sprintf(`
		SELECT id, timestamp
		FROM clicks
		WHERE timestamp %s ?
	`, direction), date)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).SendString(err.Error())
	}
	defer rows.Close()

	clicks := make([]Click, 0)
	for rows.Next() {
		click := new(Click)
		err := rows.Scan(&click.ID, &click.Timestamp)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		clicks = append(clicks, *click)
	}

	if len(clicks) == 0 {
		return c.Status(fiber.StatusNotFound).SendString("No clicks found")
	}

	return c.JSON(clicks)
}