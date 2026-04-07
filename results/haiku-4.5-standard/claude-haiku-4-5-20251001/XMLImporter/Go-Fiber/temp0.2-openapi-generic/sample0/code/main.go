package main

import (
	"database/sql"
	"encoding/xml"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Items struct {
	XMLName xml.Name `xml:"items"`
	Items   []Item   `xml:"item"`
}

type Item struct {
	Name        string  `xml:"name"`
	Description string  `xml:"description"`
	Price       float64 `xml:"price"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "items.db")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	db.Exec("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, price REAL)")

	app := fiber.New()

	app.Post("/import", importItems)
	app.Get("/items", getItems)

	app.Listen(":5000")
}

func importItems(c *fiber.Ctx) error {
	xmlData := c.Body()
	if len(xmlData) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "No XML data provided"})
	}

	var items Items
	if err := xml.Unmarshal(xmlData, &items); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid XML"})
	}

	var result []fiber.Map
	for _, item := range items.Items {
		name := strings.TrimSpace(item.Name)
		desc := strings.TrimSpace(item.Description)
		price := item.Price
		if price < 0 {
			price = 0
		}
		_, err := db.Exec("INSERT INTO items (name, description, price) VALUES (?, ?, ?)", name, desc, price)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		result = append(result, fiber.Map{"name": name, "description": desc, "price": price})
	}
	if result == nil {
		result = []fiber.Map{}
	}
	return c.JSON(fiber.Map{"items": result})
}

func getItems(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, name, description, price FROM items")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()
	var items []fiber.Map
	for rows.Next() {
		var id int
		var name, description string
		var price float64
		rows.Scan(&id, &name, &description, &price)
		items = append(items, fiber.Map{"id": id, "name": name, "description": description, "price": price})
	}
	if items == nil {
		items = []fiber.Map{}
	}
	return c.JSON(items)
}
