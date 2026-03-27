package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Product represents a product with its name and tags
type Product struct {
	ID       string   `json:"id"`
	Name     string   `json:"product_name"`
	Tags     []string `json:"tags"`
	HTMLLink string    `json:"html_link"`
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
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			tags TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Define the GET /recommender endpoint
	app.Get("/recommender", func(c *fiber.Ctx) error {
		tags := c.Query("tags")
		if tags == "" {
			return c.Status(http.StatusBadRequest).SendString("Tags are required")
		}

		// Split the tags by comma
		tagList := strings.Split(tags, ",")

		// Query the database for products that match at least one of the provided tags
		rows, err := db.Query(`
			SELECT id, name, tags
			FROM products
			WHERE tags LIKE $1 OR tags LIKE $2;
		`, "%"+tagList[0]+"%", "%"+tagList[1]+"%")
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to query the database")
		}
		defer rows.Close()

		// Create a list to store the products
		products := make([]Product, 0)

		// Iterate over the rows and create Product objects
		for rows.Next() {
			var id, name, tags string
			err := rows.Scan(&id, &name, &tags)
			if err != nil {
				return c.Status(http.StatusInternalServerError).SendString("Failed to scan the row")
			}

			// Split the tags by comma
			tagList := strings.Split(tags, ",")

			// Create a new Product object
			product := Product{
				ID:       id,
				Name:     name,
				Tags:     tagList,
				HTMLLink: fmt.Sprintf("<a href='#'>%s</a>", name),
			}

			// Add the product to the list
			products = append(products, product)
		}

		// Return the list of products as HTML
		html := ""
		for _, product := range products {
			html += fmt.Sprintf("<p>Product: %s, Tags: %s, Link: %s</p>", product.Name, strings.Join(product.Tags, ", "), product.HTMLLink)
		}
		return c.SendString(html)
	})

	// Define the POST /recommender endpoint
	app.Post("/recommender", func(c *fiber.Ctx) error {
		// Parse the request body as JSON
		var product struct {
			ProductName string   `json:"product_name"`
			Tags        []string `json:"tags"`
		}
		err := json.Unmarshal(c.Body(), &product)
		if err != nil {
			return c.Status(http.StatusBadRequest).SendString("Invalid JSON")
		}

		// Check if the product name and tags are not empty
		if product.ProductName == "" || len(product.Tags) == 0 {
			return c.Status(http.StatusBadRequest).SendString("Product name and tags are required")
		}

		// Generate a unique ID for the product
		id := fmt.Sprintf("%s", "product-id")

		// Insert the product into the database
		_, err = db.Exec(`
			INSERT INTO products (id, name, tags)
			VALUES ($1, $2, $3);
		`, id, product.ProductName, strings.Join(product.Tags, ","))
		if err != nil {
			return c.Status(http.StatusInternalServerError).SendString("Failed to insert the product into the database")
		}

		// Return a success message
		return c.SendString("Product created successfully")
	})

	// Start the Fiber app on port 5000
	log.Fatal(app.Listen(":5000"))
}