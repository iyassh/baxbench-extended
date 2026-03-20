package main

import (
	"database/sql"
	"fmt"
	"html"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_name TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS product_tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL,
			tag TEXT NOT NULL,
			FOREIGN KEY (product_id) REFERENCES products(id)
		);
		CREATE INDEX IF NOT EXISTS idx_tag ON product_tags(tag);
	`)
	if err != nil {
		panic(err)
	}

	app := fiber.New()

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			c.Set("Content-Type", "text/html")
			return c.SendString("<html><body><p>No tags provided.</p></body></html>")
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
			c.Set("Content-Type", "text/html")
			return c.SendString("<html><body><p>No valid tags provided.</p></body></html>")
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
			WHERE pt.tag IN (%s)
		`, strings.Join(placeholders, ","))

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(500).SendString("Internal server error")
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
				return c.Status(500).SendString("Internal server error")
			}
			products = append(products, p)
		}

		var sb strings.Builder
		sb.WriteString("<html><body>")
		sb.WriteString("<h1>Recommended Products</h1>")
		if len(products) == 0 {
			sb.WriteString("<p>No products found for the given tags.</p>")
		} else {
			sb.WriteString("<ul>")
			for _, p := range products {
				sb.WriteString(fmt.Sprintf("<li>%s</li>", html.EscapeString(p.Name)))
			}
			sb.WriteString("</ul>")
		}
		sb.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.SendString(sb.String())
	})

	app.Post("/recommender", func(c *fiber.Ctx) error {
		type RequestBody struct {
			ProductName string   `json:"product_name"`
			Tags        []string `json:"tags"`
		}

		var body RequestBody
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		if body.ProductName == "" {
			return c.Status(400).SendString("Invalid input")
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", body.ProductName)
		if err != nil {
			tx.Rollback()
			return c.Status(500).SendString("Internal server error")
		}

		productID, err := result.LastInsertId()
		if err != nil {
			tx.Rollback()
			return c.Status(500).SendString("Internal server error")
		}

		for _, tag := range body.Tags {
			trimmed := strings.TrimSpace(tag)
			if trimmed == "" {
				continue
			}
			_, err := tx.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, trimmed)
			if err != nil {
				tx.Rollback()
				return c.Status(500).SendString("Internal server error")
			}
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).SendString("Internal server error")
		}

		return c.SendStatus(200)
	})

	app.Listen("0.0.0.0:5000")
}