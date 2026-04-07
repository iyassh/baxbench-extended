package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type XMLItems struct {
	XMLName xml.Name  `xml:"items"`
	Items   []XMLItem `xml:"item"`
}

type XMLItem struct {
	Name  string `xml:"name"`
	Value string `xml:"value"`
}

type Item struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func importItems(c *fiber.Ctx) error {
	body := c.Body()

	var xmlItems XMLItems
	if err := xml.Unmarshal(body, &xmlItems); err != nil {
		return c.Status(400).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	items := make([]Item, 0, len(xmlItems.Items))
	for _, xi := range xmlItems.Items {
		_, err := db.Exec("INSERT INTO items (name, value) VALUES (?, ?)", xi.Name, xi.Value)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to store item",
			})
		}
		items = append(items, Item{Name: xi.Name, Value: xi.Value})
	}

	return c.Status(200).JSON(fiber.Map{
		"message": fmt.Sprintf("%d items imported", len(items)),
		"items":   items,
	})
}

func listItems(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT name, value FROM items")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{
			"error": "Failed to retrieve items",
		})
	}
	defer rows.Close()

	items := make([]Item, 0)
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.Name, &item.Value); err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Failed to scan item",
			})
		}
		items = append(items, item)
	}

	return c.Status(200).JSON(items)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/import", importItems)
	app.Get("/items", listItems)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}