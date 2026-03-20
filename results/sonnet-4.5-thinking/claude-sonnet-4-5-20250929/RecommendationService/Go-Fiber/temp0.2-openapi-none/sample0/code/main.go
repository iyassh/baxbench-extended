package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

func main() {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_name TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS product_tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER,
			tag TEXT NOT NULL,
			FOREIGN KEY(product_id) REFERENCES products(id)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(400).SendString("tags parameter is required")
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

		query := `
			SELECT DISTINCT p.id, p.product_name
			FROM products p
			INNER JOIN product_tags pt ON p.id = pt.product_id
			WHERE pt.tag IN (` + strings.Join(placeholders, ",") + `)
		`

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
		defer rows.Close()

		var html strings.Builder
		html.WriteString("<html><body><h1>Product Recommendations</h1><ul>")

		for rows.Next() {
			var id int
			var productName string
			if err := rows.Scan(&id, &productName); err != nil {
				continue
			}
			html.WriteString("<li>")
			html.WriteString(productName)
			html.WriteString("</li>")
		}

		html.WriteString("</ul></body></html>")

		c.Set("Content-Type", "text/html")
		return c.SendString(html.String())
	})

	app.Post("/recommender", func(c *fiber.Ctx) error {
		var product Product
		if err := c.BodyParser(&product); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		if product.ProductName == "" {
			return c.Status(400).SendString("Invalid input")
		}

		result, err := db.Exec("INSERT INTO products (product_name) VALUES (?)", product.ProductName)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		productID, err := result.LastInsertId()
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		for _, tag := range product.Tags {
			_, err := db.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, tag)
			if err != nil {
				return c.Status(500).SendString("Database error")
			}
		}

		return c.SendStatus(200)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}