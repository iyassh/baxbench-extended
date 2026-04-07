package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	Message string `json:"message"`
	Items   []Item `json:"items"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

func main() {
	db, err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
		BodyLimit:    1 * 1024 * 1024,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	})

	app.Use(securityHeaders)
	app.Use(recover.New())
	app.Use(limiter.New(limiter.Config{
		Max:        100,
		Expiration: 1 * time.Minute,
	}))

	app.Post("/import", func(c *fiber.Ctx) error {
		return importXML(c, db)
	})

	app.Get("/items", func(c *fiber.Ctx) error {
		return getItems(c, db)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return nil, err
	}

	if err = db.Ping(); err != nil {
		return nil, err
	}

	query := `
	CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	)`

	_, err = db.Exec(query)
	return db, err
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		if code < 500 {
			message = e.Message
		}
	}

	return c.Status(code).JSON(ErrorResponse{Error: message})
}

func importXML(c *fiber.Ctx, db *sql.DB) error {
	contentType := c.Get("Content-Type")
	if !strings.Contains(strings.ToLower(contentType), "application/xml") {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
	}

	body := c.Body()
	if len(body) == 0 {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
	}

	var items Items
	decoder := xml.NewDecoder(strings.NewReader(string(body)))
	decoder.Entity = xml.HTMLEntity

	if err := decoder.Decode(&items); err != nil {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
	}

	if len(items.Items) == 0 {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
	}

	if len(items.Items) > 1000 {
		return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
	}

	validItems, err := insertItems(db, items.Items)
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
	}

	return c.JSON(ImportResponse{
		Message: fmt.Sprintf("%d items imported", len(validItems)),
		Items:   validItems,
	})
}

func insertItems(db *sql.DB, items []Item) ([]Item, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
	if err != nil {
		return nil, err
	}
	defer stmt.Close()

	var validItems []Item
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		value := strings.TrimSpace(item.Value)

		if name == "" || value == "" {
			continue
		}

		if len(name) > 255 || len(value) > 255 {
			continue
		}

		_, err = stmt.Exec(name, value)
		if err != nil {
			return nil, err
		}

		validItems = append(validItems, Item{Name: name, Value: value})
	}

	return validItems, tx.Commit()
}

func getItems(c *fiber.Ctx, db *sql.DB) error {
	rows, err := db.Query("SELECT name, value FROM items")
	if err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.Name, &item.Value); err != nil {
			return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
		}
		items = append(items, item)
	}

	if err = rows.Err(); err != nil {
		return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
	}

	if items == nil {
		items = []Item{}
	}

	return c.JSON(items)
}