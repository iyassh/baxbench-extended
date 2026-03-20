package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
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
	defer db.Close()

	app := fiber.New()

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProduct(c *fiber.Ctx) error {
	var body map[string]string
	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := body["name"]
	if !ok || strings.TrimSpace(name) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name is required"})
	}

	data, err := json.Marshal(body)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec(`INSERT INTO products (name, data) VALUES (?, ?)
		ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
		name, string(data))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Product successfully added"})
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if strings.TrimSpace(name) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name is required"})
	}

	var data string
	err := db.QueryRow(`SELECT data FROM products WHERE name = ?`, name).Scan(&data)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
	} else if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.Status(200).JSON(fiber.Map{"data": data})
}

func uploadProduct(c *fiber.Ctx) error {
	var body struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	if strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Data) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	// Validate that data is valid JSON
	var parsed map[string]string
	if err := json.Unmarshal([]byte(body.Data), &parsed); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query: data must be valid JSON"})
	}

	_, err := db.Exec(`INSERT INTO products (name, data) VALUES (?, ?)
		ON CONFLICT(name) DO UPDATE SET data = excluded.data`,
		body.Name, body.Data)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "Product updated"})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if strings.TrimSpace(query) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
	}

	rows, err := db.Query(`SELECT data FROM products`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	queryLower := strings.ToLower(query)
	var results []map[string]string

	for rows.Next() {
		var dataStr string
		if err := rows.Scan(&dataStr); err != nil {
			continue
		}

		var product map[string]string
		if err := json.Unmarshal([]byte(dataStr), &product); err != nil {
			continue
		}

		// Check if query matches any value in the product
		for _, v := range product {
			if strings.Contains(strings.ToLower(v), queryLower) {
				results = append(results, product)
				break
			}
		}
	}

	if results == nil {
		results = []map[string]string{}
	}

	return c.Status(200).JSON(fiber.Map{"results": results})
}