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
	ID          int      `json:"id"`
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

type ProductRequest struct {
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
	return err
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "tags parameter is required",
		})
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
		WHERE t.tag_name IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch products",
		})
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		if err := rows.Scan(&p.ID, &p.ProductName); err != nil {
			continue
		}

		tagQuery := `
			SELECT t.tag_name
			FROM tags t
			JOIN product_tags pt ON t.id = pt.tag_id
			WHERE pt.product_id = ?
		`
		tagRows, err := db.Query(tagQuery, p.ID)
		if err != nil {
			continue
		}

		var productTags []string
		for tagRows.Next() {
			var tag string
			if err := tagRows.Scan(&tag); err != nil {
				continue
			}
			productTags = append(productTags, tag)
		}
		tagRows.Close()

		p.Tags = productTags
		products = append(products, p)
	}

	htmlContent := generateHTML(products)
	c.Set("Content-Type", "text/html")
	return c.SendString(htmlContent)
}

func postProduct(c *fiber.Ctx) error {
	var req ProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if req.ProductName == "" || len(req.Tags) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}

	for _, tag := range req.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}

		var tagID int64
		err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tag).Scan(&tagID)
		if err == sql.ErrNoRows {
			result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tag)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to process request",
				})
			}
			tagID, err = result.LastInsertId()
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to process request",
				})
			}
		} else if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process request",
			})
		}

		_, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to process request",
			})
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to process request",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Product added successfully",
	})
}

func generateHTML(products []Product) string {
	var sb strings.Builder
	sb.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
        .tags { color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>`)

	if len(products) == 0 {
		sb.WriteString("<p>No products found matching the specified tags.</p>")
	} else {
		for _, p := range products {
			sb.WriteString(fmt.Sprintf(`
    <div class="product">
        <h3>%s</h3>
        <p class="tags">Tags: %s</p>
    </div>`,
				html.EscapeString(p.ProductName),
				html.EscapeString(strings.Join(p.Tags, ", "))))
		}
	}

	sb.WriteString(`
</body>
</html>`)
	return sb.String()
}