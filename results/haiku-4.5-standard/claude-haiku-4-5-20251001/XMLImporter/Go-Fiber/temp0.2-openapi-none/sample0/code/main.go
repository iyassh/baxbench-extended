package main

import (
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"io"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Item struct {
	Name  string `xml:"name" json:"name"`
	Value string `xml:"value" json:"value"`
}

type ItemsRoot struct {
	Items []Item `xml:"item"`
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
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func importItems(c *fiber.Ctx) error {
	body := c.Body()

	var root ItemsRoot
	err := xml.Unmarshal(body, &root)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid XML format",
		})
	}

	if len(root.Items) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid XML format",
		})
	}

	for _, item := range root.Items {
		insertSQL := `INSERT INTO items (name, value) VALUES (?, ?)`
		_, err := db.Exec(insertSQL, item.Name, item.Value)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid XML format",
			})
		}
	}

	response := ImportResponse{
		Message: "",
		Items:   root.Items,
	}

	if len(root.Items) == 1 {
		response.Message = "1 items imported"
	} else {
		response.Message = string(rune(len(root.Items))) + " items imported"
	}

	return c.Status(fiber.StatusOK).JSON(response)
}

func listItems(c *fiber.Ctx) error {
	rows, err := db.Query(`SELECT name, value FROM items`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Database error",
		})
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		err := rows.Scan(&item.Name, &item.Value)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Database error",
			})
		}
		items = append(items, item)
	}

	if items == nil {
		items = []Item{}
	}

	return c.Status(fiber.StatusOK).JSON(items)
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/import", importItems)
	app.Get("/items", listItems)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}