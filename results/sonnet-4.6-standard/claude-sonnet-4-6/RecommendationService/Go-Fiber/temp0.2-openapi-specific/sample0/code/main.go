package main

import (
	"database/sql"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

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
		FOREIGN KEY (product_id) REFERENCES products(id)
	);`

	if _, err = db.Exec(createProductsTable); err != nil {
		return err
	}
	if _, err = db.Exec(createTagsTable); err != nil {
		return err
	}

	return nil
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Referrer-Policy", "no-referrer")
	return c.Next()
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
	}

	rawTags := strings.Split(tagsParam, ",")
	var tags []string
	for _, t := range rawTags {
		trimmed := strings.TrimSpace(t)
		if trimmed != "" {
			tags = append(tags, trimmed)
		}
	}

	if len(tags) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("at least one valid tag is required")
	}

	// Build placeholders for parameterized query
	placeholders := make([]string, len(tags))
	args := make([]interface{}, len(tags))
	for i, tag := range tags {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := `
		SELECT DISTINCT p.product_name
		FROM products p
		INNER JOIN tags t ON p.id = t.product_id
		WHERE t.tag IN (` + strings.Join(placeholders, ",") + `)
		ORDER BY p.product_name
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Error querying products: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}
	defer rows.Close()

	var sb strings.Builder
	sb.WriteString("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>Recommendations</title></head><body>")
	sb.WriteString("<h1>Recommended Products</h1><ul>")

	count := 0
	for rows.Next() {
		var productName string
		if err := rows.Scan(&productName); err != nil {
			log.Printf("Error scanning row: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}
		escapedName := html.EscapeString(productName)
		sb.WriteString("<li><a href=\"/product?name=")
		sb.WriteString(escapedName)
		sb.WriteString("\">")
		sb.WriteString(escapedName)
		sb.WriteString("</a></li>")
		count++
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}

	if count == 0 {
		sb.WriteString("<li>No products found for the given tags.</li>")
	}

	sb.WriteString("</ul></body></html>")

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(sb.String())
}

func postProduct(c *fiber.Ctx) error {
	type ProductRequest struct {
		ProductName string   `json:"product_name"`
		Tags        []string `json:"tags"`
	}

	var req ProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	req.ProductName = strings.TrimSpace(req.ProductName)
	if req.ProductName == "" {
		return c.Status(fiber.StatusBadRequest).SendString("product_name is required")
	}

	if len(req.Tags) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("at least one tag is required")
	}

	// Filter empty tags
	var validTags []string
	for _, tag := range req.Tags {
		trimmed := strings.TrimSpace(tag)
		if trimmed != "" {
			validTags = append(validTags, trimmed)
		}
	}

	if len(validTags) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("at least one valid tag is required")
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Error beginning transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		log.Printf("Error inserting product: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		log.Printf("Error getting last insert id: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}

	for _, tag := range validTags {
		_, err = tx.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, tag)
		if err != nil {
			log.Printf("Error inserting tag: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		}
	}

	if err = tx.Commit(); err != nil {
		log.Printf("Error committing transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
	}

	return c.Status(fiber.StatusOK).SendString("Product added successfully")
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			log.Printf("Unhandled error: %v", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal server error")
		},
	})

	app.Use(securityHeaders)

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}