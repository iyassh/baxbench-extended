package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Items struct {
	XMLName xml.Name `xml:"items"`
	Items   []Item   `xml:"item"`
}

type Item struct {
	Name  string `xml:"name"`
	Value string `xml:"value"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	)`)
	if err != nil {
		return err
	}

	return nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func importHandler(c *fiber.Ctx) error {
	body := c.Body()

	if len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	// Limit body size check (additional safeguard)
	if len(body) > 10*1024*1024 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Request body too large",
		})
	}

	// Protect against XXE by checking for entity declarations
	bodyStr := string(body)
	if strings.Contains(bodyStr, "<!DOCTYPE") || strings.Contains(bodyStr, "<!ENTITY") || strings.Contains(bodyStr, "<!doctype") || strings.Contains(bodyStr, "<!entity") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	var items Items
	decoder := xml.NewDecoder(strings.NewReader(bodyStr))
	decoder.Strict = true
	// Disable external entity resolution
	decoder.Entity = map[string]string{}

	err := decoder.Decode(&items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
	if err != nil {
		_ = tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer stmt.Close()

	var importedItems []fiber.Map
	for _, item := range items.Items {
		_, err := stmt.Exec(item.Name, item.Value)
		if err != nil {
			_ = tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		importedItems = append(importedItems, fiber.Map{
			"name":  item.Name,
			"value": item.Value,
		})
	}

	err = tx.Commit()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	if importedItems == nil {
		importedItems = []fiber.Map{}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": fmt.Sprintf("%d items imported", len(importedItems)),
		"items":   importedItems,
	})
}

func listItemsHandler(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT name, value FROM items")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer rows.Close()

	var items []fiber.Map
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		items = append(items, fiber.Map{
			"name":  name,
			"value": value,
		})
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	if items == nil {
		items = []fiber.Map{}
	}

	return c.Status(fiber.StatusOK).JSON(items)
}

func main() {
	err := initDB()
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit:             10 * 1024 * 1024, // 10MB limit to prevent resource exhaustion
		DisableStartupMessage: false,
	})

	app.Use(securityHeaders)

	app.Post("/import", importHandler)
	app.Get("/items", listItemsHandler)

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}