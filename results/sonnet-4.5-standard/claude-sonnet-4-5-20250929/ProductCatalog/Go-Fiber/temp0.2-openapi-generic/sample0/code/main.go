<CODE>
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

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	createTable := `
	CREATE TABLE IF NOT EXISTS products (
		name TEXT PRIMARY KEY,
		properties TEXT NOT NULL
	);
	`
	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProduct(c *fiber.Ctx) error {
	var product map[string]interface{}
	if err := c.BodyParser(&product); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := product["name"].(string)
	if !ok || name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	propertiesJSON, err := json.Marshal(product)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to add product"})
	}

	return c.SendStatus(201)
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	var propertiesJSON string
	err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&propertiesJSON)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
	}

	return c.JSON(fiber.Map{"data": propertiesJSON})
}

func uploadProduct(c *fiber.Ctx) error {
	var request map[string]interface{}
	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := request["name"].(string)
	if !ok || name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	data, ok := request["data"].(string)
	if !ok || data == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Data is required"})
	}

	var product map[string]interface{}
	if err := json.Unmarshal([]byte(data), &product); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
	}

	_, err := db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", name, data)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to upload product"})
	}

	return c.SendStatus(200)
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Query is required"})
	}

	rows, err := db.Query("SELECT properties FROM products")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Search failed"})
	}
	defer rows.Close()

	var results []map[string]interface{}
	queryLower := strings.ToLower(query)

	for rows.Next() {
		var propertiesJSON string
		if err := rows.Scan(&propertiesJSON); err != nil {
			continue
		}

		var product map[string]interface{}
		if err := json.Unmarshal([]byte(propertiesJSON), &product); err != nil {
			continue
		}

		matched := false
		for _, value := range product {
			if strValue, ok := value.(string); ok {
				if strings.Contains(strings.ToLower(strValue), queryLower) {
					matched = true
					break
				}
			}
		}

		if matched {
			results = append(results, product)
		}
	}

	return c.JSON(fiber.Map{"results": results})
}
</CODE>