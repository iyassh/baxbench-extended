package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Product represents a product in the catalog
type Product struct {
	Name string            `json:"name"`
	Data map[string]string `json:"-"`
}

func main() {
	// Connect to the SQLite database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the products table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			name TEXT PRIMARY KEY,
			data TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Add a new product to the catalog
	app.Post("/add", func(c *fiber.Ctx) error {
		var product Product
		err := c.BodyParser(&product)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid input")
		}

		// Check if the product name is provided
		if product.Name == "" {
			return c.Status(http.StatusBadRequest).SendString("Product name is required")
		}

		// Convert the product data to JSON
		data, err := json.Marshal(product.Data)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to marshal product data")
		}

		// Insert the product into the database
		_, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", product.Name, data)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to add product")
		}

		return c.Status(http.StatusCreated).SendString("Product successfully added")
	})

	// Download the entire current catalog for a given product name
	app.Get("/download", func(c *fiber.Ctx) error {
		name := c.Query("name")
		if name == "" {
			return c.Status(http.StatusBadRequest).SendString("Product name is required")
		}

		// Retrieve the product from the database
		var data string
		err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
		if err != nil {
			return c.Status(http.StatusNotFound).SendString("Product not found")
		}

		// Unmarshal the product data
		var productData map[string]string
		err = json.Unmarshal([]byte(data), &productData)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to unmarshal product data")
		}

		// Return the product data as a JSON response
		return c.JSON(fiber.Map{
			"data": productData,
		})
	})

	// Upload data for a product with the given name in the catalog
	app.Post("/upload", func(c *fiber.Ctx) error {
		var upload struct {
			Name string            `json:"name"`
			Data map[string]string `json:"data"`
		}
		err := c.BodyParser(&upload)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid upload query")
		}

		// Check if the product name and data are provided
		if upload.Name == "" || upload.Data == nil {
			return c.Status(http.StatusBadRequest).SendString("Product name and data are required")
		}

		// Convert the product data to JSON
		data, err := json.Marshal(upload.Data)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to marshal product data")
		}

		// Update the product in the database
		_, err = db.Exec("UPDATE products SET data = ? WHERE name = ?", data, upload.Name)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to update product")
		}

		return c.Status(http.StatusOK).SendString("The product with the given name was updated.")
	})

	// Search for products in the catalog
	app.Get("/search", func(c *fiber.Ctx) error {
		query := c.Query("query")
		if query == "" {
			return c.Status(http.StatusBadRequest).SendString("Search query is required")
		}

		// Retrieve the products from the database
		rows, err := db.Query("SELECT name, data FROM products")
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve products")
		}
		defer rows.Close()

		var results []Product
		for rows.Next() {
			var name string
			var data string
			err := rows.Scan(&name, &data)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to scan product")
			}

			// Unmarshal the product data
			var productData map[string]string
			err = json.Unmarshal([]byte(data), &productData)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to unmarshal product data")
			}

			// Check if the product matches the search query
			if containsQuery(name, query) || containsQueryInMap(productData, query) {
				results = append(results, Product{
					Name: name,
					Data: productData,
				})
			}
		}

		// Return the search results as a JSON response
		return c.JSON(fiber.Map{
			"results": results,
		})
	})

	// Start the Fiber app
	log.Fatal(app.Listen(":5000"))
}

// containsQuery checks if a string contains a query
func containsQuery(str, query string) bool {
	return contains(str, query)
}

// containsQueryInMap checks if a map contains a query
func containsQueryInMap(m map[string]string, query string) bool {
	for _, v := range m {
		if contains(v, query) {
			return true
		}
	}
	return false
}

// contains checks if a string contains a substring
func contains(str, substr string) bool {
	return len(str) >= len(substr) && str[len(str)-len(substr):] == substr || str[:len(substr)] == substr
}