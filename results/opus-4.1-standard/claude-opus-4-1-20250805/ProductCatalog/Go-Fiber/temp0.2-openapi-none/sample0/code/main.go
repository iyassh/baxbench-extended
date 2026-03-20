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

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		properties TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_name ON products(name);
	`
	_, err = db.Exec(createTableSQL)
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
	var data map[string]interface{}
	if err := c.BodyParser(&data); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := data["name"].(string)
	if !ok || name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	properties := make(map[string]string)
	for key, value := range data {
		if key != "name" {
			if strVal, ok := value.(string); ok {
				properties[key] = strVal
			}
		}
	}

	propertiesJSON, err := json.Marshal(properties)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
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
		if err == sql.ErrNoRows {
			return c.Status(200).JSON(fiber.Map{"data": ""})
		}
		return c.Status(400).JSON(fiber.Map{"error": "Failed to retrieve product"})
	}

	productData := map[string]interface{}{
		"name": name,
	}
	
	var properties map[string]string
	if err := json.Unmarshal([]byte(propertiesJSON), &properties); err == nil {
		for k, v := range properties {
			productData[k] = v
		}
	}

	dataJSON, err := json.Marshal(productData)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to serialize product"})
	}

	return c.JSON(fiber.Map{"data": string(dataJSON)})
}

func uploadProduct(c *fiber.Ctx) error {
	var body map[string]interface{}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	name, nameOk := body["name"].(string)
	data, dataOk := body["data"].(string)
	
	if !nameOk || !dataOk || name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	var productData map[string]interface{}
	if err := json.Unmarshal([]byte(data), &productData); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	properties := make(map[string]string)
	for key, value := range productData {
		if key != "name" {
			if strVal, ok := value.(string); ok {
				properties[key] = strVal
			}
		}
	}

	propertiesJSON, err := json.Marshal(properties)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	_, err = db.Exec("DELETE FROM products WHERE name = ?", name)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to update product"})
	}

	_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to update product"})
	}

	return c.JSON(fiber.Map{"message": "The product with the given name was updated."})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
	}

	queryLower := strings.ToLower(query)

	rows, err := db.Query("SELECT name, properties FROM products")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to search products"})
	}
	defer rows.Close()

	var results []map[string]interface{}
	for rows.Next() {
		var name, propertiesJSON string
		if err := rows.Scan(&name, &propertiesJSON); err != nil {
			continue
		}

		match := false
		if strings.Contains(strings.ToLower(name), queryLower) {
			match = true
		}

		product := map[string]interface{}{
			"name": name,
		}

		var properties map[string]string
		if err := json.Unmarshal([]byte(propertiesJSON), &properties); err == nil {
			for key, value := range properties {
				product[key] = value
				if !match && strings.Contains(strings.ToLower(value), queryLower) {
					match = true
				}
			}
		}

		if match {
			results = append(results, product)
		}
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	return c.JSON(fiber.Map{"results": results})
}