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

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_name TEXT NOT NULL
	)`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS product_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		tag TEXT NOT NULL,
		FOREIGN KEY (product_id) REFERENCES products(id)
	)`)
	if err != nil {
		return err
	}

	return nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
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

	// Build parameterized query
	placeholders := make([]string, len(tags))
	args := make([]interface{}, len(tags))
	for i, tag := range tags {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := `SELECT DISTINCT p.id, p.product_name 
		FROM products p 
		JOIN product_tags pt ON p.id = pt.product_id 
		WHERE pt.tag IN (` + strings.Join(placeholders, ",") + `)`

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Println("Query error:", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}
	defer rows.Close()

	var sb strings.Builder
	sb.WriteString("<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>")
	sb.WriteString("<h1>Recommended Products</h1><ul>")

	count := 0
	for rows.Next() {
		var id int
		var productName string
		if err := rows.Scan(&id, &productName); err != nil {
			log.Println("Scan error:", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
		escapedName := html.EscapeString(productName)
		sb.WriteString("<li><a href=\"/product/")
		sb.WriteString(html.EscapeString(strings.ReplaceAll(productName, " ", "-")))
		sb.WriteString("\">")
		sb.WriteString(escapedName)
		sb.WriteString("</a></li>")
		count++
	}

	if err := rows.Err(); err != nil {
		log.Println("Rows error:", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	if count == 0 {
		sb.WriteString("<li>No products found for the given tags.</li>")
	}

	sb.WriteString("</ul></body></html>")

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.Status(fiber.StatusOK).SendString(sb.String())
}

func postProduct(c *fiber.Ctx) error {
	type RequestBody struct {
		ProductName string   `json:"product_name"`
		Tags        []string `json:"tags"`
	}

	var body RequestBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
	}

	if strings.TrimSpace(body.ProductName) == "" {
		return c.Status(fiber.StatusBadRequest).SendString("product_name is required")
	}

	if len(body.Tags) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("at least one tag is required")
	}

	tx, err := db.Begin()
	if err != nil {
		log.Println("Transaction begin error:", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", strings.TrimSpace(body.ProductName))
	if err != nil {
		log.Println("Insert product error:", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		log.Println("LastInsertId error:", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	for _, tag := range body.Tags {
		trimmedTag := strings.TrimSpace(tag)
		if trimmedTag == "" {
			continue
		}
		_, err = tx.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, trimmedTag)
		if err != nil {
			log.Println("Insert tag error:", err)
			return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
		}
	}

	if err = tx.Commit(); err != nil {
		log.Println("Commit error:", err)
		return c.Status(fiber.StatusInternalServerError).SendString("Internal Server Error")
	}

	return c.Status(fiber.StatusOK).SendString("Product added successfully")
}