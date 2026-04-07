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
	XMLName xml.Name `xml:"item" json:"-"`
	Name    string   `xml:"name" json:"name"`
	Value   string   `xml:"value" json:"value"`
}

type ImportResponse struct {
	Message string `json:"message"`
	Items   []Item `json:"items"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS items (
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
	if err := xml.Unmarshal(body, &items); err != nil {
		return c.Status(400).JSON(ErrorResponse{
			Error: "Invalid XML format",
		})
	}

	insertSQL := "INSERT INTO items (name, value) VALUES (?, ?)"
	
	for _, item := range items.Items {
		_, err := db.Exec(insertSQL, item.Name, item.Value)
		if err != nil {
			return c.Status(500).JSON(ErrorResponse{
				Error: "Database error",
			})
		}
	}

	message := fmt.Sprintf("%d items imported", len(items.Items))
	return c.JSON(ImportResponse{
		Message: message,
		Items:   items.Items,
	})
}

func getItems(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT name, value FROM items")
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{
			Error: "Database error",
		})
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.Name, &item.Value); err != nil {
			return c.Status(500).JSON(ErrorResponse{
				Error: "Database error",
			})
		}
		items = append(items, item)
	}

	return c.JSON(items)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/import", importItems)
	app.Get("/items", getItems)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}