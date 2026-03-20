package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	// Create products table with dynamic columns
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		properties TEXT NOT NULL
	);`
	
	_, err = db.Exec(createTableSQL)
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	// Add product endpoint
	app.Post("/add", func(c *fiber.Ctx) error {
		var productData map[string]interface{}
		if err := c.BodyParser(&productData); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		// Check if name exists
		nameInterface, exists := productData["name"]
		if !exists {
			return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
		}

		name, ok := nameInterface.(string)
		if !ok || name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Name must be a non-empty string"})
		}

		// Validate all properties are strings
		for key, value := range productData {
			if _, ok := value.(string); !ok {
				return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("Property '%s' must be a string", key)})
			}
		}

		// Convert to JSON for storage
		propertiesJSON, err := json.Marshal(productData)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to process product data"})
		}

		// Insert into database
		_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
		if err != nil {
			if strings.Contains(err.Error(), "UNIQUE constraint failed") {
				return c.Status(400).JSON(fiber.Map{"error": "Product with this name already exists"})
			}
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add product"})
		}

		return c.SendStatus(201)
	})

	// Download product endpoint
	app.Get("/download", func(c *fiber.Ctx) error {
		name := c.Query("name")
		if name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
		}

		var properties string
		err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&properties)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
			}
			return c.Status(500).JSON(fiber.Map{"error": "Failed to retrieve product"})
		}

		return c.JSON(fiber.Map{"data": properties})
	})

	// Upload product endpoint
	app.Post("/upload", func(c *fiber.Ctx) error {
		var uploadData struct {
			Name string `json:"name"`
			Data string `json:"data"`
		}

		if err := c.BodyParser(&uploadData); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if uploadData.Name == "" || uploadData.Data == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Both name and data are required"})
		}

		// Validate that data is valid JSON
		var testParse map[string]interface{}
		if err := json.Unmarshal([]byte(uploadData.Data), &testParse); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Data must be valid JSON"})
		}

		// Update or insert the product
		result, err := db.Exec("UPDATE products SET properties = ? WHERE name = ?", uploadData.Data, uploadData.Name)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to update product"})
		}

		rowsAffected, _ := result.RowsAffected()
		if rowsAffected == 0 {
			// Product doesn't exist, insert it
			_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", uploadData.Name, uploadData.Data)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to create product"})
			}
		}

		return c.SendStatus(200)
	})

	// Search products endpoint
	app.Get("/search", func(c *fiber.Ctx) error {
		query := c.Query("query")
		if query == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Query parameter is required"})
		}

		// Search in both name and properties
		rows, err := db.Query("SELECT name, properties FROM products WHERE name LIKE ? OR properties LIKE ?", 
			"%"+query+"%", "%"+query+"%")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to search products"})
		}
		defer rows.Close()

		var results []map[string]interface{}
		for rows.Next() {
			var name, properties string
			if err := rows.Scan(&name, &properties); err != nil {
				continue
			}

			var productData map[string]interface{}
			if err := json.Unmarshal([]byte(properties), &productData); err != nil {
				continue
			}

			// Check if any property value contains the query
			match := false
			if strings.Contains(strings.ToLower(name), strings.ToLower(query)) {
				match = true
			} else {
				for _, value := range productData {
					if strValue, ok := value.(string); ok {
						if strings.Contains(strings.ToLower(strValue), strings.ToLower(query)) {
							match = true
							break
						}
					}
				}
			}

			if match {
				results = append(results, productData)
			}
		}

		return c.JSON(fiber.Map{"results": results})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}