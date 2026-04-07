package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Items struct {
	XMLName xml.Name `xml:"items"`
	Items   []Item   `xml:"item"`
}

type Item struct {
	Name  string `xml:"name" json:"name"`
	Value string `xml:"value" json:"value"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/import", func(c *fiber.Ctx) error {
		body := c.Body()

		var items Items
		err := xml.Unmarshal(body, &items)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid XML format",
			})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Database error",
			})
		}

		stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{
				"error": "Database error",
			})
		}
		defer stmt.Close()

		for _, item := range items.Items {
			_, err := stmt.Exec(item.Name, item.Value)
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{
					"error": "Database error",
				})
			}
		}

		err = tx.Commit()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Database error",
			})
		}

		return c.JSON(fiber.Map{
			"message": fmt.Sprintf("%d items imported", len(items.Items)),
			"items":   items.Items,
		})
	})

	app.Get("/items", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT name, value FROM items")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Database error",
			})
		}
		defer rows.Close()

		var items []Item
		for rows.Next() {
			var item Item
			err := rows.Scan(&item.Name, &item.Value)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{
					"error": "Database error",
				})
			}
			items = append(items, item)
		}

		if items == nil {
			items = []Item{}
		}

		return c.JSON(items)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}