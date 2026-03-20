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
	ID           int      `json:"id"`
	ProductName  string   `json:"product_name"`
	Tags         []string `json:"tags"`
}

type PostRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_name TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS product_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		tag TEXT NOT NULL,
		FOREIGN KEY (product_id) REFERENCES products(id)
	);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

func getProductsByTags(tags []string) ([]Product, error) {
	if len(tags) == 0 {
		return []Product{}, nil
	}

	placeholders := make([]string, len(tags))
	args := make([]interface{}, len(tags))
	for i, tag := range tags {
		placeholders[i] = "?"
		args[i] = strings.TrimSpace(tag)
	}

	query := `
	SELECT DISTINCT p.id, p.product_name
	FROM products p
	WHERE p.id IN (
		SELECT DISTINCT product_id FROM product_tags
		WHERE tag IN (` + strings.Join(placeholders, ",") + `)
	)
	ORDER BY p.id
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var id int
		var productName string
		if err := rows.Scan(&id, &productName); err != nil {
			return nil, err
		}

		tagRows, err := db.Query("SELECT tag FROM product_tags WHERE product_id = ? ORDER BY tag", id)
		if err != nil {
			return nil, err
		}

		var productTags []string
		for tagRows.Next() {
			var tag string
			if err := tagRows.Scan(&tag); err != nil {
				tagRows.Close()
				return nil, err
			}
			productTags = append(productTags, tag)
		}
		tagRows.Close()

		products = append(products, Product{
			ID:          id,
			ProductName: productName,
			Tags:        productTags,
		})
	}

	return products, rows.Err()
}

func postProduct(productName string, tags []string) error {
	result, err := db.Exec("INSERT INTO products (product_name) VALUES (?)", productName)
	if err != nil {
		return err
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return err
	}

	for _, tag := range tags {
		_, err := db.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, strings.TrimSpace(tag))
		if err != nil {
			return err
		}
	}

	return nil
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
		}

		tags := strings.Split(tagsParam, ",")
		products, err := getProductsByTags(tags)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Error retrieving products")
		}

		html := `<!DOCTYPE html>
<html>
<head>
	<title>Product Recommendations</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; }
		.product { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
		.tags { color: #666; font-size: 0.9em; }
		.tag { display: inline-block; background: #e0e0e0; padding: 2px 8px; margin: 2px; border-radius: 3px; }
	</style>
</head>
<body>
	<h1>Product Recommendations</h1>
	<p>Search tags: <strong>` + tagsParam + `</strong></p>`

		if len(products) == 0 {
			html += `<p>No products found matching the provided tags.</p>`
		} else {
			html += `<div>`
			for _, product := range products {
				html += `<div class="product">
					<h3>` + product.ProductName + `</h3>
					<div class="tags">`
				for _, tag := range product.Tags {
					html += `<span class="tag">` + tag + `</span>`
				}
				html += `</div>
				</div>`
			}
			html += `</div>`
		}

		html += `</body>
</html>`

		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	app.Post("/recommender", func(c *fiber.Ctx) error {
		var req PostRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		if req.ProductName == "" || len(req.Tags) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
		}

		err := postProduct(req.ProductName, req.Tags)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to post product"})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Product posted successfully"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}