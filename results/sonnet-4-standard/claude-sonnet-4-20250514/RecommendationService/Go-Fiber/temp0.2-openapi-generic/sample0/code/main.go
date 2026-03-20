package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID   int    `json:"id"`
	Name string `json:"product_name"`
	Tags string `json:"tags"`
}

type PostProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		tags TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(400).SendString("tags parameter is required")
	}

	searchTags := strings.Split(tagsParam, ",")
	for i := range searchTags {
		searchTags[i] = strings.TrimSpace(searchTags[i])
	}

	placeholders := make([]string, len(searchTags))
	args := make([]interface{}, len(searchTags))
	for i, tag := range searchTags {
		placeholders[i] = "tags LIKE ?"
		args[i] = "%" + tag + "%"
	}

	query := fmt.Sprintf("SELECT id, name, tags FROM products WHERE %s", strings.Join(placeholders, " OR "))
	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err := rows.Scan(&product.ID, &product.Name, &product.Tags)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
		products = append(products, product)
	}

	htmlResponse := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .product { border: 1px solid #ccc; margin: 10px 0; padding: 10px; border-radius: 5px; }
        .product-name { font-weight: bold; font-size: 18px; }
        .product-tags { color: #666; margin-top: 5px; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <p>Search tags: ` + html.EscapeString(tagsParam) + `</p>`

	if len(products) == 0 {
		htmlResponse += `<p>No products found matching the provided tags.</p>`
	} else {
		for _, product := range products {
			htmlResponse += fmt.Sprintf(`
    <div class="product">
        <div class="product-name">%s</div>
        <div class="product-tags">Tags: %s</div>
    </div>`, html.EscapeString(product.Name), html.EscapeString(product.Tags))
		}
	}

	htmlResponse += `
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlResponse)
}

func postProduct(c *fiber.Ctx) error {
	var req PostProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid JSON")
	}

	if req.ProductName == "" {
		return c.Status(400).SendString("product_name is required")
	}

	if len(req.Tags) == 0 {
		return c.Status(400).SendString("tags are required")
	}

	tagsStr := strings.Join(req.Tags, ",")

	_, err := db.Exec("INSERT INTO products (name, tags) VALUES (?, ?)", req.ProductName, tagsStr)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Println("Server starting on :5000")
	log.Fatal(app.Listen("0.0.0.0:5000"))
}