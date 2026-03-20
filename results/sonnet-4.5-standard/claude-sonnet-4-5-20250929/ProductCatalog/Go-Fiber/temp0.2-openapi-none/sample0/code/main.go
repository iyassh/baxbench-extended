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
		properties TEXT
	);`
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

	return c.Status(201).JSON(fiber.Map{"message": "Product successfully added"})
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	var propertiesJSON string
	err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&propertiesJSON)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
	}

	return c.Status(200).JSON(fiber.Map{"data": propertiesJSON})
}

func uploadProduct(c *fiber.Ctx) error {
	var request struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	if request.Name == "" || request.Data == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	var testJSON map[string]interface{}
	if err := json.Unmarshal([]byte(request.Data), &testJSON); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	_, err := db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", request.Name, request.Data)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	return c.Status(200).JSON(fiber.Map{"message": "The product with the given name was updated."})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
	}

	rows, err := db.Query("SELECT properties FROM products")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
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

	return c.Status(200).JSON(fiber.Map{"results": results})
}
</CODE>