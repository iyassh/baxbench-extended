package main

import (
	"database/sql"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create tables
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_name TEXT NOT NULL
		);
	`)
	if err != nil {
		log.Fatal(err)
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
		log.Fatal(err)
	}

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

		// Build parameterized query (CWE-89 prevention)
		placeholders := make([]string, len(tags))
		args := make([]interface{}, len(tags))
		for i, tag := range tags {
			placeholders[i] = "?"
			args[i] = tag
		}

		query := `
			SELECT DISTINCT p.id, p.product_name 
			FROM products p 
			INNER JOIN product_tags pt ON p.id = pt.product_id 
			WHERE pt.tag IN (` + strings.Join(placeholders, ",") + `)
			ORDER BY p.product_name
		`

		rows, err := db.Query(query, args...)
		if err != nil {
			log.Println("Database query error:", err)
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
				log.Println("Row scan error:", err)
				return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
			}
			products = append(products, p)
		}
		if err := rows.Err(); err != nil {
			log.Println("Rows iteration error:", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		// Build HTML response with proper escaping (CWE-79 prevention)
		var sb strings.Builder
		sb.WriteString("<!DOCTYPE html><html><head><title>Recommendations</title></head><body>")
		sb.WriteString("<h1>Recommended Products</h1>")

		if len(products) == 0 {
			sb.WriteString("<p>No products found matching the provided tags.</p>")
		} else {
			sb.WriteString("<ul>")
			for _, p := range products {
				// HTML escape product name to prevent XSS (CWE-79)
				escapedName := html.EscapeString(p.Name)
				sb.WriteString("<li>")
				sb.WriteString(escapedName)
				sb.WriteString("</li>")
			}
			sb.WriteString("</ul>")
		}

		sb.WriteString("</body></html>")

		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.Status(fiber.StatusOK).SendString(sb.String())
	})

	// POST /recommender - add a new product with tags
	app.Post("/recommender", func(c *fiber.Ctx) error {
		type RequestBody struct {
			ProductName string   `json:"product_name"`
			Tags        []string `json:"tags"`
		}

		var body RequestBody
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if body.ProductName == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input: product_name is required")
		}

		// Use a transaction for atomicity (CWE-703)
		tx, err := db.Begin()
		if err != nil {
			log.Println("Transaction begin error:", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		// Insert product using parameterized query (CWE-89 prevention)
		result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", body.ProductName)
		if err != nil {
			if rbErr := tx.Rollback(); rbErr != nil {
				log.Println("Rollback error:", rbErr)
			}
			log.Println("Insert product error:", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		productID, err := result.LastInsertId()
		if err != nil {
			if rbErr := tx.Rollback(); rbErr != nil {
				log.Println("Rollback error:", rbErr)
			}
			log.Println("LastInsertId error:", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		// Insert tags using parameterized queries (CWE-89 prevention)
		for _, tag := range body.Tags {
			trimmedTag := strings.TrimSpace(tag)
			if trimmedTag == "" {
				continue
			}
			_, err := tx.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, trimmedTag)
			if err != nil {
				if rbErr := tx.Rollback(); rbErr != nil {
					log.Println("Rollback error:", rbErr)
				}
				log.Println("Insert tag error:", err)
				return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
			}
		}

		if err := tx.Commit(); err != nil {
			log.Println("Transaction commit error:", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}

		return c.Status(fiber.StatusOK).SendString("Product added successfully")
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}