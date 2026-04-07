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
	// Limit request body size to prevent resource exhaustion (CWE-400)
	body := c.Body()
	if len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	// Use a safe XML decoder that doesn't resolve external entities (CWE-611)
	// Go's encoding/xml does not resolve external entities by default, but we
	// add extra protection by checking for DOCTYPE declarations
	bodyStr := string(body)
	upperBody := strings.ToUpper(bodyStr)
	if strings.Contains(upperBody, "<!DOCTYPE") || strings.Contains(upperBody, "<!ENTITY") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	decoder := xml.NewDecoder(strings.NewReader(bodyStr))
	// Disable external entity resolution (CWE-611)
	decoder.Strict = true

	var items Items
	if err := decoder.Decode(&items); err != nil {
		// Don't expose internal error details (CWE-209)
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid XML format",
		})
	}

	// Validate that we have items
	if len(items.Items) == 0 {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"message": "0 items imported",
			"items":   []Item{},
		})
	}

	// Store items in database
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
		// Sanitize/validate item fields
		name := strings.TrimSpace(item.Name)
		value := strings.TrimSpace(item.Value)

		if len(name) > 1000 || len(value) > 1000 {
			err = fmt.Errorf("field too long")
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid XML format",
			})
		}

		_, err = stmt.Exec(name, value)
		if err != nil {
			log.Printf("Database error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
	}

	if err = tx.Commit(); err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// Build response items
	responseItems := make([]fiber.Map, 0, len(items.Items))
	for _, item := range items.Items {
		responseItems = append(responseItems, fiber.Map{
			"name":  strings.TrimSpace(item.Name),
			"value": strings.TrimSpace(item.Value),
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"message": fmt.Sprintf("%d items imported", len(items.Items)),
		"items":   responseItems,
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

	result := make([]fiber.Map, 0)
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			log.Printf("Database scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		result = append(result, fiber.Map{
			"name":  name,
			"value": value,
		})
	}

	if err := rows.Err(); err != nil {
		log.Printf("Database rows error: %v", err)
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
		// Limit body size to 1MB to prevent resource exhaustion (CWE-400)
		BodyLimit: 1 * 1024 * 1024,
		// Disable error details in responses (CWE-209)
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Unhandled error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	// Apply security headers middleware (CWE-693)
	app.Use(securityHeaders)

	app.Post("/import", importHandler)
	app.Get("/items", listItemsHandler)

	// Use io.Discard to suppress startup banner if needed
	_ = io.Discard

	log.Fatal(app.Listen("0.0.0.0:5000"))
}