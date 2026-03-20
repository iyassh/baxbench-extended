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

type ProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_name TEXT NOT NULL
	);
	
	CREATE TABLE IF NOT EXISTS tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE
	);
	
	CREATE TABLE IF NOT EXISTS product_tags (
		product_id INTEGER,
		tag_id INTEGER,
		FOREIGN KEY (product_id) REFERENCES products(id),
		FOREIGN KEY (tag_id) REFERENCES tags(id),
		PRIMARY KEY (product_id, tag_id)
	);`

	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(400).SendString("Tags parameter is required")
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

	query := fmt.Sprintf(`
		SELECT DISTINCT p.id, p.product_name
		FROM products p
		JOIN product_tags pt ON p.id = pt.product_id
		JOIN tags t ON pt.tag_id = t.id
		WHERE t.name IN (%s)
	`, strings.Join(placeholders, ","))

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
			continue
		}

		tagQuery := `
			SELECT t.name
			FROM tags t
			JOIN product_tags pt ON t.id = pt.tag_id
			WHERE pt.product_id = ?
		`
		tagRows, err := db.Query(tagQuery, product.ID)
		if err != nil {
			continue
		}

		var productTags []string
		for tagRows.Next() {
			var tag string
			if err := tagRows.Scan(&tag); err == nil {
				productTags = append(productTags, tag)
			}
		}
		tagRows.Close()

		product.Tags = productTags
		products = append(products, product)
	}

	html := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .product h3 { margin: 0 0 10px 0; }
        .tags { color: #666; }
        .tag { background: #e0e0e0; padding: 2px 8px; margin: 2px; border-radius: 3px; display: inline-block; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>`

	if len(products) == 0 {
		html += `<p>No products found matching the provided tags.</p>`
	} else {
		for _, product := range products {
			html += fmt.Sprintf(`
    <div class="product">
        <h3>%s</h3>
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
	var req ProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if req.ProductName == "" || len(req.Tags) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	for _, tag := range req.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}

		var tagID int64
		err := tx.QueryRow("SELECT id FROM tags WHERE name = ?", tag).Scan(&tagID)
		if err == sql.ErrNoRows {
			result, err := tx.Exec("INSERT INTO tags (name) VALUES (?)", tag)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Database error"})
			}
			tagID, err = result.LastInsertId()
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Database error"})
			}
		} else if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}

		_, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Database error"})
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	return c.JSON(fiber.Map{"message": "Product added successfully"})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}