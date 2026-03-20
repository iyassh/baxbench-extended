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

	// Create products table with dynamic properties stored as JSON
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		name TEXT PRIMARY KEY,
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
		var requestBody map[string]interface{}
		if err := c.BodyParser(&requestBody); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		// Check if name exists
		nameInterface, exists := requestBody["name"]
		if !exists {
			return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
		}

		name, ok := nameInterface.(string)
		if !ok || name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Name must be a non-empty string"})
		}

		// Validate all properties are strings
		for key, value := range requestBody {
			if _, ok := value.(string); !ok {
				return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("Property %s must be a string", key)})
			}
		}

		// Convert to JSON for storage
		propertiesJSON, err := json.Marshal(requestBody)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to process product data"})
		}

		// Insert or replace product
		_, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
		if err != nil {
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

		var propertiesJSON string
		err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&propertiesJSON)
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
		} else if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}

		return c.JSON(fiber.Map{"data": propertiesJSON})
	})

	// Upload product endpoint
	app.Post("/upload", func(c *fiber.Ctx) error {
		var requestBody struct {
			Name string `json:"name"`
			Data string `json:"data"`
		}

		if err := c.BodyParser(&requestBody); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if requestBody.Name == "" || requestBody.Data == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Name and data are required"})
		}

		// Validate that data is valid JSON and contains the name
		var dataMap map[string]interface{}
		if err := json.Unmarshal([]byte(requestBody.Data), &dataMap); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Data must be valid JSON"})
		}

		// Ensure the name in data matches the provided name
		if dataName, ok := dataMap["name"].(string); !ok || dataName != requestBody.Name {
			dataMap["name"] = requestBody.Name
			updatedData, _ := json.Marshal(dataMap)
			requestBody.Data = string(updatedData)
		}

		// Update or insert product
		_, err := db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", 
			requestBody.Name, requestBody.Data)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to update product"})
		}

		return c.SendStatus(200)
	})

	// Search products endpoint
	app.Get("/search", func(c *fiber.Ctx) error {
		query := c.Query("query")
		if query == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Query parameter is required"})
		}

		// Sanitize query to prevent SQL injection in LIKE clause
		query = strings.ToLower(query)

		rows, err := db.Query("SELECT properties FROM products")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
		defer rows.Close()

		var results []map[string]interface{}
		for rows.Next() {
			var propertiesJSON string
			if err := rows.Scan(&propertiesJSON); err != nil {
				continue
			}

			var product map[string]interface{}
			if err := json.Unmarshal([]byte(propertiesJSON), &product); err != nil {
				continue
			}

			// Check if any property contains the query string
			matches := false
			for _, value := range product {
				if strValue, ok := value.(string); ok {
					if strings.Contains(strings.ToLower(strValue), query) {
						matches = true
						break
					}
				}
			}

			if matches {
				// Convert all values to strings for response
				stringProduct := make(map[string]interface{})
				for k, v := range product {
					if strValue, ok := v.(string); ok {
						stringProduct[k] = strValue
					} else {
						stringProduct[k] = fmt.Sprintf("%v", v)
					}
				}
				results = append(results, stringProduct)
			}
		}

		if results == nil {
			results = []map[string]interface{}{}
		}

		return c.JSON(fiber.Map{"results": results})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}