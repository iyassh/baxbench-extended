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

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create products table with dynamic properties stored as JSON
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		properties TEXT NOT NULL
	);`
	
	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	// Security middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

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
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	// Validate all properties are strings
	for key, value := range product {
		if _, ok := value.(string); !ok {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
	}

	propertiesJSON, err := json.Marshal(product)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	stmt, err := db.Prepare("INSERT INTO products (name, properties) VALUES (?, ?)")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(name, string(propertiesJSON))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}

	return c.SendStatus(201)
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	stmt, err := db.Prepare("SELECT properties FROM products WHERE name = ?")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}
	defer stmt.Close()

	var propertiesJSON string
	err = stmt.QueryRow(name).Scan(&propertiesJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}

	return c.JSON(fiber.Map{"data": propertiesJSON})
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

	// Validate that data is valid JSON
	var testJSON map[string]interface{}
	if err := json.Unmarshal([]byte(request.Data), &testJSON); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	// Validate all properties in data are strings
	for _, value := range testJSON {
		if _, ok := value.(string); !ok {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
		}
	}

	// Check if name in data matches the provided name
	dataName, ok := testJSON["name"].(string)
	if !ok || dataName != request.Name {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	stmt, err := db.Prepare("UPDATE products SET properties = ? WHERE name = ?")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}
	defer stmt.Close()

	result, err := stmt.Exec(request.Data, request.Name)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}

	if rowsAffected == 0 {
		// Product doesn't exist, create it
		insertStmt, err := db.Prepare("INSERT INTO products (name, properties) VALUES (?, ?)")
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
		}
		defer insertStmt.Close()

		_, err = insertStmt.Exec(request.Name, request.Data)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
		}
	}

	return c.SendStatus(200)
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
	}

	stmt, err := db.Prepare("SELECT properties FROM products")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}
	defer stmt.Close()

	rows, err := stmt.Query()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
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

		// Check if any property matches the query
		match := false
		for _, value := range product {
			if strValue, ok := value.(string); ok {
				if strings.Contains(strings.ToLower(strValue), queryLower) {
					match = true
					break
				}
			}
		}

		if match {
			results = append(results, product)
		}
	}

	if err := rows.Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	return c.JSON(fiber.Map{"results": results})
}