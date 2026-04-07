package main

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"io"
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

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `CREATE TABLE IF NOT EXISTS items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		value TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	return err
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func importHandler(c *fiber.Ctx) error {
	body := c.Body()

	// Limit body size to prevent resource exhaustion (CWE-400)
	if len(body) > 1*1024*1024 { // 1MB limit
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Request body too large",
		})
	}

	// Use a safe XML decoder that doesn't resolve external entities (CWE-611)
	decoder := xml.NewDecoder(strings.NewReader(string(body)))

	// Disable external entity resolution by providing a custom entity map
	// and restricting the token types we process
	decoder.Strict = true
	decoder.AutoClose = xml.HTMLAutoClose
	decoder.Entity = xml.HTMLEntity

	var items Items
	err := decoder.Decode(&items)
	if err != nil {
		if err == io.EOF {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid XML format",
			})
		}
		// Don't expose internal error details (CWE-209)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	// Limit number of items to prevent resource exhaustion (CWE-400)
	if len(items.Items) > 10000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Too many items in request",
		})
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer stmt.Close()

	for _, item := range items.Items {
		_, err = stmt.Exec(item.Name, item.Value)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
	}

	err = tx.Commit()
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": fmt.Sprintf("%d items imported", len(items.Items)),
		"items":   items.Items,
	})
}

func listItemsHandler(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT name, value FROM items")
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer rows.Close()

	result := make([]Item, 0)
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.Name, &item.Value); err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		result = append(result, item)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusOK).JSON(result)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable default error handler to avoid leaking sensitive info (CWE-209)
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Unhandled error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
		// Limit request body size (CWE-400)
		BodyLimit: 1 * 1024 * 1024, // 1MB
	})

	// Apply security headers middleware (CWE-693)
	app.Use(securityHeaders)

	app.Post("/import", importHandler)
	app.Get("/items", listItemsHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}