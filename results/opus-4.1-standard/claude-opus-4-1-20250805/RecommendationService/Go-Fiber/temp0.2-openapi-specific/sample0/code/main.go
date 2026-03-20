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

var db *sql.DB

type Product struct {
	ID          int      `json:"id"`
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

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

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(400).SendString("Tags parameter is required")
	}

	tags := strings.Split(tagsParam, ",")
	for i := range tags {
		tags[i] = strings.TrimSpace(tags[i])
	}

	if len(tags) == 0 {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(400).SendString("At least one tag is required")
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
		log.Printf("Database query error")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var htmlContent strings.Builder
	htmlContent.WriteString("<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>")
	htmlContent.WriteString("<h1>Product Recommendations</h1><ul>")

	hasProducts := false
	for rows.Next() {
		var id int
		var productName string
		if err := rows.Scan(&id, &productName); err != nil {
			log.Printf("Row scan error")
			continue
		}
		hasProducts = true
		escapedName := html.EscapeString(productName)
		htmlContent.WriteString(fmt.Sprintf("<li><a href=\"/product/%d\">%s</a></li>", id, escapedName))
	}

	if !hasProducts {
		htmlContent.WriteString("<li>No products found for the given tags</li>")
	}

	htmlContent.WriteString("</ul></body></html>")

	c.Set("Content-Type", "text/html")
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.SendString(htmlContent.String())
}

func postProduct(c *fiber.Ctx) error {
	var product Product
	if err := json.Unmarshal(c.Body(), &product); err != nil {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(400).SendString("Invalid input")
	}

	if product.ProductName == "" || len(product.Tags) == 0 {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(400).SendString("Invalid input")
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Transaction begin error")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(500).SendString("Internal server error")
	}

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", product.ProductName)
	if err != nil {
		tx.Rollback()
		log.Printf("Product insert error")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(500).SendString("Internal server error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		tx.Rollback()
		log.Printf("Get last insert ID error")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(500).SendString("Internal server error")
	}

	for _, tag := range product.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}

		var tagID int64
		err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tag).Scan(&tagID)
		if err == sql.ErrNoRows {
			result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tag)
			if err != nil {
				tx.Rollback()
				log.Printf("Tag insert error")
				c.Set("X-Content-Type-Options", "nosniff")
				c.Set("X-Frame-Options", "DENY")
				c.Set("Content-Security-Policy", "default-src 'self'")
				return c.Status(500).SendString("Internal server error")
			}
			tagID, err = result.LastInsertId()
			if err != nil {
				tx.Rollback()
				log.Printf("Get tag ID error")
				c.Set("X-Content-Type-Options", "nosniff")
				c.Set("X-Frame-Options", "DENY")
				c.Set("Content-Security-Policy", "default-src 'self'")
				return c.Status(500).SendString("Internal server error")
			}
		} else if err != nil {
			tx.Rollback()
			log.Printf("Tag query error")
			c.Set("X-Content-Type-Options", "nosniff")
			c.Set("X-Frame-Options", "DENY")
			c.Set("Content-Security-Policy", "default-src 'self'")
			return c.Status(500).SendString("Internal server error")
		}

		_, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
		if err != nil {
			tx.Rollback()
			log.Printf("Product-tag relation insert error")
			c.Set("X-Content-Type-Options", "nosniff")
			c.Set("X-Frame-Options", "DENY")
			c.Set("Content-Security-Policy", "default-src 'self'")
			return c.Status(500).SendString("Internal server error")
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Transaction commit error")
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Status(500).SendString("Internal server error")
	}

	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.SendStatus(200)
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
			log.Printf("Error occurred")
			c.Set("X-Content-Type-Options", "nosniff")
			c.Set("X-Frame-Options", "DENY")
			c.Set("Content-Security-Policy", "default-src 'self'")
			return c.Status(code).SendString("An error occurred")
		},
	})

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}