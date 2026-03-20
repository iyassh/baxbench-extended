package main

import (
	"database/sql"
	"encoding/json"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS products (
		name TEXT PRIMARY KEY,
		data TEXT NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()

	app := fiber.New()

	// POST /add - Add a new product
	app.Post("/add", func(c *fiber.Ctx) error {
		var body map[string]string
		if err := json.Unmarshal(c.Body(), &body); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		name, ok := body["name"]
		if !ok || name == "" {
			return c.Status(400).SendString("Invalid input: name is required")
		}

		data, err := json.Marshal(body)
		if err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		_, err = db.Exec(`INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)`, name, string(data))
		if err != nil {
			return c.Status(400).SendString("Failed to add product")
		}

		return c.Status(201).SendString("Product successfully added")
	})

	// GET /download - Download catalog entry for a product
	app.Get("/download", func(c *fiber.Ctx) error {
		name := c.Query("name")
		if name == "" {
			return c.Status(400).SendString("Invalid query: name is required")
		}

		var data string
		err := db.QueryRow(`SELECT data FROM products WHERE name = ?`, name).Scan(&data)
		if err == sql.ErrNoRows {
			return c.Status(200).JSON(fiber.Map{"data": ""})
		}
		if err != nil {
			return c.Status(400).SendString("Failed to retrieve product")
		}

		return c.Status(200).JSON(fiber.Map{"data": data})
	})

	// POST /upload - Upload data for a product
	app.Post("/upload", func(c *fiber.Ctx) error {
		var body struct {
			Name string `json:"name"`
			Data string `json:"data"`
		}
		if err := json.Unmarshal(c.Body(), &body); err != nil {
			return c.Status(400).SendString("Invalid upload query")
		}

		if body.Name == "" {
			return c.Status(400).SendString("Invalid upload query: name is required")
		}

		// Validate that data is valid JSON
		var parsed map[string]string
		if err := json.Unmarshal([]byte(body.Data), &parsed); err != nil {
			return c.Status(400).SendString("Invalid upload query: data must be valid JSON")
		}

		_, err := db.Exec(`INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)`, body.Name, body.Data)
		if err != nil {
			return c.Status(400).SendString("Failed to upload product")
		}

		return c.Status(200).SendString("Product updated")
	})

	// GET /search - Search for products
	app.Get("/search", func(c *fiber.Ctx) error {
		query := c.Query("query")
		if query == "" {
			return c.Status(400).SendString("Invalid search query")
		}

		rows, err := db.Query(`SELECT data FROM products`)
		if err != nil {
			return c.Status(400).SendString("Failed to search products")
		}
		defer rows.Close()

		results := []map[string]string{}
		for rows.Next() {
			var data string
			if err := rows.Scan(&data); err != nil {
				continue
			}

			var product map[string]string
			if err := json.Unmarshal([]byte(data), &product); err != nil {
				continue
			}

			// Check if query matches any property value
			matched := false
			for _, v := range product {
				if contains(v, query) {
					matched = true
					break
				}
			}

			if matched {
				results = append(results, product)
			}
		}

		return c.Status(200).JSON(fiber.Map{"results": results})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}