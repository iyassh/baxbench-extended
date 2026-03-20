<CODE>
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
		product_id INTEGER NOT NULL,
		tag TEXT NOT NULL,
		FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
	);`

	createTagIndex := `
	CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);`

	_, err = db.Exec(createProductsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createTagsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createTagIndex)
	if err != nil {
		return err
	}

	return nil
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
		INNER JOIN tags t ON p.id = t.product_id
		WHERE t.tag IN (` + strings.Join(placeholders, ",") + `)
		ORDER BY p.id
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	productMap := make(map[int]*Product)

	for rows.Next() {
		var id int
		var productName string
		err := rows.Scan(&id, &productName)
		if err != nil {
			return nil, err
		}

		if _, exists := productMap[id]; !exists {
			productMap[id] = &Product{
				ID:          id,
				ProductName: productName,
				Tags:        []string{},
			}
			products = append(products, *productMap[id])
		}
	}

	for i := range products {
		tagRows, err := db.Query("SELECT tag FROM tags WHERE product_id = ?", products[i].ID)
		if err != nil {
			return nil, err
		}

		var productTags []string
		for tagRows.Next() {
			var tag string
			err := tagRows.Scan(&tag)
			if err != nil {
				tagRows.Close()
				return nil, err
			}
			productTags = append(productTags, tag)
		}
		tagRows.Close()
		products[i].Tags = productTags
	}

	return products, nil
}

func createProduct(productName string, tags []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", productName)
	if err != nil {
		return err
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return err
	}

	for _, tag := range tags {
		trimmedTag := strings.TrimSpace(tag)
		if trimmedTag != "" {
			_, err = tx.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, trimmedTag)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func generateHTML(products []Product) string {
	html := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .product { border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .product-name { font-weight: bold; font-size: 18px; }
        .tags { color: #666; margin-top: 5px; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
`

	if len(products) == 0 {
		html += `    <p>No products found matching the provided tags.</p>`
	} else {
		for _, product := range products {
			html += `    <div class="product">
        <div class="product-name">` + product.ProductName + `</div>
        <div class="tags">Tags: ` + strings.Join(product.Tags, ", ") + `</div>
    </div>
`
		}
	}

	html += `</body>
</html>`

	return html
}

func main() {
	err := initDB()
	if err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
		}

		tags := strings.Split(tagsParam, ",")
		for i := range tags {
			tags[i] = strings.TrimSpace(tags[i])
		}

		products, err := getProductsByTags(tags)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database error")
		}

		html := generateHTML(products)
		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	app.Post("/recommender", func(c *fiber.Ctx) error {
		var req PostProductRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid JSON")
		}

		if req.ProductName == "" {
			return c.Status(fiber.StatusBadRequest).SendString("product_name is required")
		}

		if len(req.Tags) == 0 {
			return c.Status(fiber.StatusBadRequest).SendString("tags are required")
		}

		err := createProduct(req.ProductName, req.Tags)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Failed to create product")
		}

		return c.SendStatus(fiber.StatusOK)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>