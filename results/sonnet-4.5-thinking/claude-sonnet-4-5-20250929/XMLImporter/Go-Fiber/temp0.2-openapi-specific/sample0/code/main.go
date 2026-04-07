package main

import (
	"bytes"
	"database/sql"
	"encoding/xml"
	"fmt"
	"log"
	"strings"

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

type ImportResponse struct {
	Message string `json:"message"`
	Items   []Item `json:"items"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

var db *sql.DB

func main() {
	// Initialize database
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			value TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		BodyLimit: 1 * 1024 * 1024, // 1MB limit to prevent CWE-400
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			// CWE-209: Don't expose internal error details
			code := fiber.StatusInternalServerError
			message := "Internal server error"

			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code == fiber.StatusBadRequest || code == fiber.StatusNotFound {
					message = e.Message
				}
			}

			return c.Status(code).JSON(ErrorResponse{Error: message})
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	// POST /import
	app.Post("/import", importHandler)

	// GET /items
	app.Get("/items", listItemsHandler)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func importHandler(c *fiber.Ctx) error {
	// Check content type
	contentType := strings.ToLower(c.Get("Content-Type"))
	if !strings.HasPrefix(contentType, "application/xml") {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid XML format",
		})
	}

	// Read body
	body := c.Body()
	if len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid XML format",
		})
	}

	// Parse XML - Go's xml.Decoder doesn't process external entities by default (CWE-611 protection)
	var items Items
	decoder := xml.NewDecoder(bytes.NewReader(body))
	decoder.Strict = true

	err := decoder.Decode(&items)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid XML format",
		})
	}

	// Validate items
	if len(items.Items) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Error: "Invalid XML format",
		})
	}

	// Store in database
	for _, item := range items.Items {
		_, err := db.Exec("INSERT INTO items (name, value) VALUES (?, ?)", item.Name, item.Value)
		if err != nil {
			// CWE-209: Generic error message
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Failed to import items",
			})
		}
	}

	message := fmt.Sprintf("%d items imported", len(items.Items))
	return c.JSON(ImportResponse{
		Message: message,
		Items:   items.Items,
	})
}

func listItemsHandler(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT name, value FROM items")
	if err != nil {
		// CWE-209: Generic error message
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Failed to retrieve items",
		})
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		err := rows.Scan(&item.Name, &item.Value)
		if err != nil {
			// CWE-209: Generic error message
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Error: "Failed to retrieve items",
			})
		}
		items = append(items, item)
	}

	// CWE-703: Check for errors from iterating over rows
	if err = rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Error: "Failed to retrieve items",
		})
	}

	// Return empty array if no items
	if items == nil {
		items = []Item{}
	}

	return c.JSON(items)
}