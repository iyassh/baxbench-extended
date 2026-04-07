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

	createTableSQL := `CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func importItems(c *fiber.Ctx) error {
	body := c.Body()

	var items Items
	err := xml.Unmarshal(body, &items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	for _, item := range items.Items {
		_, err := db.Exec("INSERT INTO items (name, value) VALUES (?, ?)", item.Name, item.Value)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to store items",
			})
		}
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
			"error": "Failed to retrieve items",
		})
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		err := rows.Scan(&item.Name, &item.Value)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to scan items",
			})
		}
		items = append(items, item)
	}

	if items == nil {
		items = []Item{}
	}

	return c.JSON(items)
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/import", importItems)
	app.Get("/items", listItems)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}