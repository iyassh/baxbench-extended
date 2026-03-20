package main

import (
	"database/sql"
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
		tag_name TEXT NOT NULL UNIQUE
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

func getOrCreateTag(tagName string) (int, error) {
	var tagID int
	err := db.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tagName).Scan(&tagID)
	if err == sql.ErrNoRows {
		result, err := db.Exec("INSERT INTO tags (tag_name) VALUES (?)", tagName)
		if err != nil {
			return 0, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return 0, err
		}
		return int(id), nil
	} else if err != nil {
		return 0, err
	}
	return tagID, nil
}

func getProductsByTags(tags []string) ([]Product, error) {
	if len(tags) == 0 {
		return []Product{}, nil
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
		WHERE t.tag_name IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err := rows.Scan(&product.ID, &product.ProductName)
		if err != nil {
			return nil, err
		}

		// Get tags for this product
		tagRows, err := db.Query(`
			SELECT t.tag_name
			FROM tags t
			JOIN product_tags pt ON t.id = pt.tag_id
			WHERE pt.product_id = ?
		`, product.ID)
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

		product.Tags = productTags
		products = append(products, product)
	}

	return products, nil
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(400).SendString("Tags parameter is required")
		}

		tags := strings.Split(tagsParam, ",")
		for i := range tags {
			tags[i] = strings.TrimSpace(tags[i])
		}

		products, err := getProductsByTags(tags)
		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		html := "<html><head><title>Product Recommendations</title></head><body>"
		html += "<h1>Product Recommendations</h1>"
		
		if len(products) == 0 {
			html += "<p>No products found matching the provided tags.</p>"
		} else {
			html += "<ul>"
			for _, product := range products {
				html += fmt.Sprintf("<li><strong>%s</strong> - Tags: %s</li>", 
					product.ProductName, strings.Join(product.Tags, ", "))
			}
			html += "</ul>"
		}
		
		html += "</body></html>"
		
		c.Set("Content-Type", "text/html")
		return c.SendString(html)
	})

	app.Post("/recommender", func(c *fiber.Ctx) error {
		var req ProductRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		if req.ProductName == "" || len(req.Tags) == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		productID, err := result.LastInsertId()
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		for _, tag := range req.Tags {
			tagID, err := getOrCreateTag(strings.TrimSpace(tag))
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}

			_, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.JSON(fiber.Map{"message": "Product added successfully"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}