package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func initDB() (*sql.DB, error) {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_name TEXT NOT NULL
		);
	`)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS product_tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL,
			tag TEXT NOT NULL,
			FOREIGN KEY (product_id) REFERENCES products(id)
		);
	`)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_product_tags_tag ON product_tags(tag);
	`)
	if err != nil {
		return nil, err
	}

	return db, nil
}

func main() {
	db, err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString("An error occurred")
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	// GET /recommender - search products by tags
	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Tags parameter is required")
		}

		// Split tags by comma and trim whitespace
		rawTags := strings.Split(tagsParam, ",")
		var tags []string
		for _, t := range rawTags {
			trimmed := strings.TrimSpace(t)
			if trimmed != "" {
				tags = append(tags, trimmed)
			}
		}

		if len(tags) == 0 {
			return c.Status(fiber.StatusBadRequest).SendString("At least one valid tag is required")
		}

		// Build parameterized query to prevent SQL injection (CWE-89)
		placeholders := make([]string, len(tags))
		args := make([]interface{}, len(tags))
		for i, tag := range tags {
			placeholders[i] = "?"
			args[i] = strings.ToLower(tag)
		}

		query := fmt.Sprintf(`
			SELECT DISTINCT p.id, p.product_name 
			FROM products p 
			INNER JOIN product_tags pt ON p.id = pt.product_id 
			WHERE LOWER(pt.tag) IN (%s)
			ORDER BY p.product_name
		`, strings.Join(placeholders, ","))

		rows, err := db.Query(query, args...)
		if err != nil {
			log.Printf("Database query error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}
		defer rows.Close()

		type Product struct {
			ID   int
			Name string
		}

		var products []Product
		for rows.Next() {
			var p Product
			if err := rows.Scan(&p.ID, &p.Name); err != nil {
				log.Printf("Row scan error: %v", err)
				return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
			}
			products = append(products, p)
		}

		if err := rows.Err(); err != nil {
			log.Printf("Rows iteration error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		// Fetch tags for each product
		type ProductWithTags struct {
			ID   int
			Name string
			Tags []string
		}

		var productsWithTags []ProductWithTags
		for _, p := range products {
			tagRows, err := db.Query("SELECT tag FROM product_tags WHERE product_id = ?", p.ID)
			if err != nil {
				log.Printf("Database query error: %v", err)
				return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
			}

			var productTags []string
			for tagRows.Next() {
				var tag string
				if err := tagRows.Scan(&tag); err != nil {
					tagRows.Close()
					log.Printf("Row scan error: %v", err)
					return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
				}
				productTags = append(productTags, tag)
			}
			if err := tagRows.Err(); err != nil {
				tagRows.Close()
				log.Printf("Rows iteration error: %v", err)
				return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
			}
			tagRows.Close()

			productsWithTags = append(productsWithTags, ProductWithTags{
				ID:   p.ID,
				Name: p.Name,
				Tags: productTags,
			})
		}

		// Build HTML response with proper escaping (CWE-79)
		var htmlBuilder strings.Builder
		htmlBuilder.WriteString("<!DOCTYPE html>\n<html>\n<head><title>Product Recommendations</title></head>\n<body>\n")
		htmlBuilder.WriteString("<h1>Product Recommendations</h1>\n")

		// Show searched tags (escaped)
		htmlBuilder.WriteString("<p>Searched tags: ")
		for i, tag := range tags {
			if i > 0 {
				htmlBuilder.WriteString(", ")
			}
			htmlBuilder.WriteString(html.EscapeString(tag))
		}
		htmlBuilder.WriteString("</p>\n")

		if len(productsWithTags) == 0 {
			htmlBuilder.WriteString("<p>No products found matching the provided tags.</p>\n")
		} else {
			htmlBuilder.WriteString("<ul>\n")
			for _, p := range productsWithTags {
				// Escape product name to prevent XSS (CWE-79)
				escapedName := html.EscapeString(p.Name)
				htmlBuilder.WriteString(fmt.Sprintf("<li><strong>%s</strong>", escapedName))

				if len(p.Tags) > 0 {
					htmlBuilder.WriteString(" - Tags: ")
					for i, tag := range p.Tags {
						if i > 0 {
							htmlBuilder.WriteString(", ")
						}
						htmlBuilder.WriteString(html.EscapeString(tag))
					}
				}

				htmlBuilder.WriteString("</li>\n")
			}
			htmlBuilder.WriteString("</ul>\n")
		}

		htmlBuilder.WriteString("</body>\n</html>")

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(htmlBuilder.String())
	})

	// POST /recommender - add a new product with tags
	app.Post("/recommender", func(c *fiber.Ctx) error {
		type ProductInput struct {
			ProductName string   `json:"product_name"`
			Tags        []string `json:"tags"`
		}

		var input ProductInput
		if err := c.BodyParser(&input); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		// Validate input
		if strings.TrimSpace(input.ProductName) == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: product_name is required")
		}

		// Use a transaction for atomicity (CWE-703)
		tx, err := db.Begin()
		if err != nil {
			log.Printf("Transaction begin error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		// Insert product using parameterized queries (CWE-89)
		result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", input.ProductName)
		if err != nil {
			if rollbackErr := tx.Rollback(); rollbackErr != nil {
				log.Printf("Rollback error: %v", rollbackErr)
			}
			log.Printf("Insert product error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		productID, err := result.LastInsertId()
		if err != nil {
			if rollbackErr := tx.Rollback(); rollbackErr != nil {
				log.Printf("Rollback error: %v", rollbackErr)
			}
			log.Printf("LastInsertId error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		// Insert tags using parameterized queries (CWE-89)
		for _, tag := range input.Tags {
			trimmedTag := strings.TrimSpace(tag)
			if trimmedTag == "" {
				continue
			}
			_, err := tx.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, trimmedTag)
			if err != nil {
				if rollbackErr := tx.Rollback(); rollbackErr != nil {
					log.Printf("Rollback error: %v", rollbackErr)
				}
				log.Printf("Insert tag error: %v", err)
				return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
			}
		}

		if err := tx.Commit(); err != nil {
			log.Printf("Transaction commit error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		return c.SendStatus(fiber.StatusOK)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}