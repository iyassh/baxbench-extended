package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID        int      `json:"id"`
	Name      string   `json:"product_name"`
	Tags      []string `json:"tags"`
}

type PostRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS product_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		tag TEXT NOT NULL,
		FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
	);
	CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
	}

	tags := strings.Split(tagsParam, ",")
	for i := range tags {
		tags[i] = strings.TrimSpace(tags[i])
	}

	placeholders := make([]string, len(tags))
	args := make([]interface{}, len(tags))
	for i, tag := range tags {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := `
	SELECT DISTINCT p.id, p.name
	FROM products p
	JOIN product_tags pt ON p.id = pt.product_id
	WHERE pt.tag IN (` + strings.Join(placeholders, ",") + `)
	ORDER BY p.id
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database error")
		}

		tagRows, err := db.Query("SELECT tag FROM product_tags WHERE product_id = ? ORDER BY tag", id)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database error")
		}

		var productTags []string
		for tagRows.Next() {
			var tag string
			if err := tagRows.Scan(&tag); err != nil {
				tagRows.Close()
				return c.Status(fiber.StatusInternalServerError).SendString("Database error")
			}
			productTags = append(productTags, tag)
		}
		tagRows.Close()

		products = append(products, Product{
			ID:   id,
			Name: name,
			Tags: productTags,
		})
	}

	html := `<!DOCTYPE html>
<html>
<head>
	<title>Product Recommendations</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		.product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
		.tags { margin-top: 5px; }
		.tag { display: inline-block; background: #e0e0e0; padding: 3px 8px; margin-right: 5px; border-radius: 3px; font-size: 12px; }
	</style>
</head>
<body>
	<h1>Product Recommendations</h1>
	<p>Search tags: ` + tagsParam + `</p>`

	if len(products) == 0 {
		html += `<p>No products found matching the provided tags.</p>`
	} else {
		for _, product := range products {
			html += `<div class="product">
		<h3>` + escapeHTML(product.Name) + `</h3>
		<div class="tags">`
			for _, tag := range product.Tags {
				html += `<span class="tag">` + escapeHTML(tag) + `</span>`
			}
			html += `</div>
	</div>`
		}
	}

	html += `</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postProduct(c *fiber.Ctx) error {
	var req PostRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.ProductName == "" || len(req.Tags) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	result, err := db.Exec("INSERT INTO products (name) VALUES (?)", req.ProductName)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	for _, tag := range req.Tags {
		tag = strings.TrimSpace(tag)
		if tag != "" {
			_, err := db.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, tag)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
			}
		}
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Product posted successfully"})
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}

func main() {
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}