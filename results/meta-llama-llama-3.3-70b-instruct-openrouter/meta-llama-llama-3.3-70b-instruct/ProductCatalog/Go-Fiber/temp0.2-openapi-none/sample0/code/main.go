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
	Name string                 `json:"name"`
	Data map[string]string     `json:"-"`
	JSON json.RawMessage       `json:"data"`
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

		// Check if the product name is empty
		if product.Name == "" {
			return c.Status(http.StatusBadRequest).SendString("Product name is required")
		}

		// Insert the product into the database
		_, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", product.Name, string(product.JSON))
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to add product")
		}

		return c.Status(http.StatusCreated).SendString("Product successfully added")
	})

	// Download the entire current catalog with its unstructured properties for a given product name
	app.Get("/download", func(c *fiber.Ctx) error {
		name := c.Query("name")
		if name == "" {
			return c.Status(http.StatusBadRequest).SendString("Product name is required")
		}

		// Query the product from the database
		var data string
		err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(http.StatusNotFound).SendString("Product not found")
			}
			return c.Status(http.StatusInternalServerError).SendString("Failed to download product")
		}

		// Return the product data as JSON
		return c.Status(http.StatusOK).JSON(fiber.Map{"data": data})
	})

	// Upload data for a product with the given name in the catalog
	app.Post("/upload", func(c *fiber.Ctx) error {
		var upload struct {
			Name string `json:"name"`
			Data string `json:"data"`
		}
		err := c.BodyParser(&upload)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid upload query")
		}

		// Check if the product name and data are empty
		if upload.Name == "" || upload.Data == "" {
			return c.Status(http.StatusBadRequest).SendString("Product name and data are required")
		}

		// Update the product in the database
		_, err = db.Exec("UPDATE products SET data = ? WHERE name = ?", upload.Data, upload.Name)
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to update product")
		}

		return c.Status(http.StatusOK).SendString("Product updated successfully")
	})

	// Search for products in the catalog
	app.Get("/search", func(c *fiber.Ctx) error {
		query := c.Query("query")
		if query == "" {
			return c.Status(http.StatusBadRequest).SendString("Search query is required")
		}

		// Query the products from the database
		rows, err := db.Query("SELECT name, data FROM products")
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to search products")
		}
		defer rows.Close()

		var results []Product
		for rows.Next() {
			var product Product
			err := rows.Scan(&product.Name, &product.JSON)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to scan product")
			}

			// Unmarshal the product data
			err = json.Unmarshal(product.JSON, &product.Data)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to unmarshal product data")
			}

			// Check if the product matches the search query
			if containsValue(product.Data, query) || product.Name == query {
				results = append(results, product)
			}
		}

		// Return the search results as JSON
		return c.Status(http.StatusOK).JSON(fiber.Map{"results": results})
	})

	// Start the Fiber app
	log.Fatal(app.Listen(":5000"))
}

// containsValue checks if a value is present in a map
func containsValue(m map[string]string, value string) bool {
	for _, v := range m {
		if v == value {
			return true
		}
	}
	return false
}