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

type Product struct {
	ID          int      `json:"id"`
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
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

	createProductsTable := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_name TEXT NOT NULL
	);`

	createTagsTable := `
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER,
		tag TEXT NOT NULL,
		FOREIGN KEY(product_id) REFERENCES products(id)
	);`

	_, err = db.Exec(createProductsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createTagsTable)
	if err != nil {
		return err
	}

	return nil
}

func getProductsByTags(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(400).SendString("tags parameter is required")
	}

	searchTags := strings.Split(tagsParam, ",")
	for i := range searchTags {
		searchTags[i] = strings.TrimSpace(searchTags[i])
	}

	placeholders := strings.Repeat("?,", len(searchTags))
	placeholders = placeholders[:len(placeholders)-1]

	query := fmt.Sprintf(`
		SELECT DISTINCT p.id, p.product_name 
		FROM products p 
		JOIN tags t ON p.id = t.product_id 
		WHERE t.tag IN (%s)
	`, placeholders)

	args := make([]interface{}, len(searchTags))
	for i, tag := range searchTags {
		args[i] = tag
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err := rows.Scan(&product.ID, &product.ProductName)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		tagRows, err := db.Query("SELECT tag FROM tags WHERE product_id = ?", product.ID)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		var tags []string
		for tagRows.Next() {
			var tag string
			tagRows.Scan(&tag)
			tags = append(tags, tag)
		}
		tagRows.Close()

		product.Tags = tags
		products = append(products, product)
	}

	html := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .product { border: 1px solid #ccc; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .product-name { font-weight: bold; font-size: 18px; color: #333; }
        .tags { margin-top: 5px; }
        .tag { background-color: #e7f3ff; padding: 3px 8px; margin: 2px; border-radius: 3px; display: inline-block; }
        .no-products { text-align: center; color: #666; font-style: italic; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <p>Searched tags: ` + tagsParam + `</p>`

	if len(products) == 0 {
		html += `<div class="no-products">No products found matching the specified tags.</div>`
	} else {
		for _, product := range products {
			html += fmt.Sprintf(`
    <div class="product">
        <div class="product-name">%s</div>
        <div class="tags">`, product.ProductName)

			for _, tag := range product.Tags {
				html += fmt.Sprintf(`<span class="tag">%s</span>`, tag)
			}

			html += `</div>
    </div>`
		}
	}

	html += `
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postProduct(c *fiber.Ctx) error {
	var req PostProductRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return c.Status(400).SendString("Invalid JSON")
	}

	if req.ProductName == "" || len(req.Tags) == 0 {
		return c.Status(400).SendString("product_name and tags are required")
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	for _, tag := range req.Tags {
		_, err := tx.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, tag)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
	}

	if err := tx.Commit(); err != nil {
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

	app.Get("/recommender", getProductsByTags)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}