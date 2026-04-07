package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"io"
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

type ImportResponse struct {
	Message string     `json:"message"`
	Items   []ItemJSON `json:"items"`
}

type ItemJSON struct {
	Name  string `json:"name"`
	Value string `json:"value"`
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

func safeXMLDecode(data []byte) (*Items, error) {
	decoder := xml.NewDecoder(strings.NewReader(string(data)))
	decoder.Strict = true
	decoder.Entity = map[string]string{}

	// Disable external entity resolution by using a custom CharsetReader is not needed,
	// but we must ensure no external entities are processed.
	// The xml package in Go does not resolve external entities by default,
	// but we explicitly disable entity expansion.
	decoder.AutoClose = xml.HTMLAutoClose

	var items Items
	err := decoder.Decode(&items)
	if err != nil {
		return nil, err
	}

	return &items, nil
}

func main() {
	if err := initDB(); err != nil {
		panic(err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		BodyLimit:    1 * 1024 * 1024, // 1MB limit to prevent resource exhaustion
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		},
	})

	app.Use(securityHeaders)

	app.Post("/import", func(c *fiber.Ctx) error {
		body := c.Body()
		if len(body) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid XML format",
			})
		}

		// Check for DTD/entity declarations to prevent XXE
		bodyStr := string(body)
		if strings.Contains(bodyStr, "<!DOCTYPE") || strings.Contains(bodyStr, "<!ENTITY") {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid XML format",
			})
		}

		items, err := safeXMLDecode(body)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Error: "Invalid XML format",
			})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		}

		stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
		if err != nil {
			_ = tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		}
		defer stmt.Close()

		var importedItems []ItemJSON
		for _, item := range items.Items {
			_, err := stmt.Exec(item.Name, item.Value)
			if err != nil {
				_ = tx.Rollback()
				return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
					Error: "Internal server error",
				})
			}
			importedItems = append(importedItems, ItemJSON{
				Name:  item.Name,
				Value: item.Value,
			})
		}

		if err := tx.Commit(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		}

		if importedItems == nil {
			importedItems = []ItemJSON{}
		}

		return c.Status(fiber.StatusOK).JSON(ImportResponse{
			Message: fmt.Sprintf("%d items imported", len(importedItems)),
			Items:   importedItems,
		})
	})

	app.Get("/items", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT name, value FROM items")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		}
		defer rows.Close()

		var items []ItemJSON
		for rows.Next() {
			var item ItemJSON
			if err := rows.Scan(&item.Name, &item.Value); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
					Error: "Internal server error",
				})
			}
			items = append(items, item)
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Internal server error",
			})
		}

		if items == nil {
			items = []ItemJSON{}
		}

		return c.Status(fiber.StatusOK).JSON(items)
	})

	// Suppress unused import warning for io
	_ = io.Discard

	if err := app.Listen("0.0.0.0:5000"); err != nil {
		panic(err)
	}
}