package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/url"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type ProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

type Product struct {
	ID          int
	ProductName string
}

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_name TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL,
			tag TEXT NOT NULL,
			FOREIGN KEY (product_id) REFERENCES products(id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag)`)
	if err != nil {
		return err
	}

	return nil
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	return c.Next()
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(400).SendString("tags parameter is required")
	}

	tagList := strings.Split(tagsParam, ",")
	if len(tagList) == 0 {
		return c.Status(400).SendString("At least one tag is required")
	}

	for i := range tagList {
		tagList[i] = strings.TrimSpace(tagList[i])
	}

	placeholders := make([]string, len(tagList))
	args := make([]interface{}, len(tagList))
	for i, tag := range tagList {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT p.id, p.product_name
		FROM products p
		INNER JOIN tags t ON p.id = t.product_id
		WHERE t.tag IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Database query error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var p Product
		err := rows.Scan(&p.ID, &p.ProductName)
		if err != nil {
			log.Printf("Row scan error: %v", err)
			continue
		}
		products = append(products, p)
	}

	if err = rows.Err(); err != nil {
		log.Printf("Rows iteration error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<!DOCTYPE html>\n<html>\n<head>\n")
	htmlBuilder.WriteString("<meta charset=\"UTF-8\">\n")
	htmlBuilder.WriteString("<title>Product Recommendations</title>\n")
	htmlBuilder.WriteString("</head>\n<body>\n")
	htmlBuilder.WriteString("<h1>Product Recommendations</h1>\n")

	if len(products) == 0 {
		htmlBuilder.WriteString("<p>No products found matching the provided tags.</p>\n")
	} else {
		htmlBuilder.WriteString("<ul>\n")
		for _, p := range products {
			escapedName := html.EscapeString(p.ProductName)
			htmlBuilder.WriteString(fmt.Sprintf("<li><a href=\"/recommender?tags=%s\">%s</a></li>\n",
				url.QueryEscape(p.ProductName), escapedName))
		}
		htmlBuilder.WriteString("</ul>\n")
	}

	htmlBuilder.WriteString("</body>\n</html>")

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(htmlBuilder.String())
}

func postProduct(c *fiber.Ctx) error {
	var req ProductRequest

	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return c.Status(400).SendString("Invalid JSON")
	}

	if req.ProductName == "" {
		return c.Status(400).SendString("product_name is required")
	}

	if len(req.Tags) == 0 {
		return c.Status(400).SendString("At least one tag is required")
	}

	tx, err := db.Begin()
	if err != nil {
		log.Printf("Transaction begin error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		log.Printf("Product insert error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		log.Printf("LastInsertId error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	for _, tag := range req.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}

		_, err := tx.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, tag)
		if err != nil {
			log.Printf("Tag insert error: %v", err)
			return c.Status(500).SendString("Internal server error")
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("Transaction commit error: %v", err)
		return c.Status(500).SendString("Internal server error")
	}

	return c.SendStatus(200)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			log.Printf("Error: %v", err)
			return c.Status(code).SendString("Internal server error")
		},
	})

	app.Use(securityHeadersMiddleware)

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}