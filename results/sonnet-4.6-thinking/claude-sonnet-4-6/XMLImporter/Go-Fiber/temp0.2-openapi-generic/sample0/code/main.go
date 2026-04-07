package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Item struct {
	Name  string `xml:"name" json:"name"`
	Value string `xml:"value" json:"value"`
}

type Items struct {
	XMLName xml.Name `xml:"items"`
	Items   []Item   `xml:"item"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	return err
}

func importItems(c *fiber.Ctx) error {
	body := c.Body()
	if len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	var items Items
	if err := xml.Unmarshal(body, &items); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	defer stmt.Close()

	for _, item := range items.Items {
		_, err := stmt.Exec(item.Name, item.Value)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Database error",
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": fmt.Sprintf("%d items imported", len(items.Items)),
		"items":   items.Items,
	})
}

func listItems(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT name, value FROM items")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}
	defer rows.Close()

	result := []Item{}
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.Name, &item.Value); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Database error",
			})
		}
		result = append(result, item)
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Database error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(result)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/import", importItems)
	app.Get("/items", listItems)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}