<CODE>
package main

import (
	"database/sql"
	"encoding/json"
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

func main() {
	err := initDB()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).SendString("An error occurred")
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
		return c.Status(fiber.StatusBadRequest).SendString("An error occurred")
	}

	tagsList := strings.Split(tagsParam, ",")
	for i := range tagsList {
		tagsList[i] = strings.TrimSpace(tagsList[i])
	}

	if len(tagsList) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("An error occurred")
	}

	placeholders := make([]string, len(tagsList))
	args := make([]interface{}, len(tagsList))
	for i, tag := range tagsList {
		placeholders[i] = "?"
		args[i] = tag
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
		log.Printf("Database query error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		err := rows.Scan(&p.ID, &p.ProductName)
		if err != nil {
			log.Printf("Row scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
		}

		tagRows, err := db.Query("SELECT tag FROM tags WHERE product_id = ?", p.ID)
		if err != nil {
			log.Printf("Tag query error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
		}

		var tags []string
		for tagRows.Next() {
			var tag string
			if err := tagRows.Scan(&tag); err != nil {
				tagRows.Close()
				log.Printf("Tag scan error: %v", err)
				return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
			}
			tags = append(tags, tag)
		}
		tagRows.Close()

		p.Tags = tags
		products = append(products, p)
	}

	if err = rows.Err(); err != nil {
		log.Printf("Rows iteration error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
	}

	htmlContent := buildHTMLResponse(products)
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlContent)
}

func buildHTMLResponse(products []Product) string {
	var sb strings.Builder
	sb.WriteString("<!DOCTYPE html>\n<html>\n<head>\n<title>Product Recommendations</title>\n</head>\n<body>\n")
	sb.WriteString("<h1>Product Recommendations</h1>\n")

	if len(products) == 0 {
		sb.WriteString("<p>No products found.</p>\n")
	} else {
		sb.WriteString("<ul>\n")
		for _, p := range products {
			sb.WriteString("<li>")
			sb.WriteString("<strong>")
			sb.WriteString(html.EscapeString(p.ProductName))
			sb.WriteString("</strong>")
			if len(p.Tags) > 0 {
				sb.WriteString(" (Tags: ")
				for i, tag := range p.Tags {
					if i > 0 {
						sb.WriteString(", ")
					}
					sb.WriteString(html.EscapeString(tag))
				}
				sb.WriteString(")")
			}
			sb.WriteString("</li>\n")
		}
		sb.WriteString("</ul>\n")
	}

	sb.WriteString("</body>\n</html>")
	return sb.String()
}

func postProduct(c *fiber.Ctx) error {
	var req PostProductRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if req.ProductName == "" {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Transaction begin error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
	}

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		tx.Rollback()
		log.Printf("Product insert error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		tx.Rollback()
		log.Printf("Last insert ID error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
	}

	for _, tag := range req.Tags {
		tag = strings.TrimSpace(tag)
		if tag != "" {
			_, err := tx.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, tag)
			if err != nil {
				tx.Rollback()
				log.Printf("Tag insert error: %v", err)
				return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
			}
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Transaction commit error: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
	}

	return c.SendStatus(fiber.StatusOK)
}
</CODE>