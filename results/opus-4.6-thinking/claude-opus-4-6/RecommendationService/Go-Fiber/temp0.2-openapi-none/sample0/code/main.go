package main

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}

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
	`)
	if err != nil {
		panic(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			c.Set("Content-Type", "text/html")
			return c.SendString("<html><body><p>No tags provided.</p></body></html>")
		}

		tags := strings.Split(tagsParam, ",")
		for i, t := range tags {
			tags[i] = strings.TrimSpace(t)
		}

		placeholders := make([]string, len(tags))
		args := make([]interface{}, len(tags))
		for i, t := range tags {
			placeholders[i] = "?"
			args[i] = t
		}

		query := fmt.Sprintf(`
			SELECT DISTINCT p.id, p.product_name
			FROM products p
			JOIN product_tags pt ON p.id = pt.product_id
			WHERE pt.tag IN (%s)
		`, strings.Join(placeholders, ","))

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(500).SendString("Database error")
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
				return c.Status(500).SendString("Database error")
			}
			products = append(products, p)
		}

		var html strings.Builder
		html.WriteString("<html><body>")
		html.WriteString("<h1>Recommended Products</h1>")
		if len(products) == 0 {
			html.WriteString("<p>No products found for the given tags.</p>")
		} else {
			html.WriteString("<ul>")
			for _, p := range products {
				html.WriteString(fmt.Sprintf("<li><a href=\"/recommender?tags=%s\">%s</a></li>", tagsParam, p.Name))
			}
			html.WriteString("</ul>")
		}
		html.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.SendString(html.String())
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

		result, err := db.Exec("INSERT INTO products (product_name) VALUES (?)", body.ProductName)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		productID, err := result.LastInsertId()
		if err != nil {
			return c.Status(500).SendString("Database error")
		}

		for _, tag := range body.Tags {
			tag = strings.TrimSpace(tag)
			if tag == "" {
				continue
			}
			_, err := db.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, tag)
			if err != nil {
				return c.Status(500).SendString("Database error")
			}
		}

		return c.SendString("OK")
	})

	app.Listen("0.0.0.0:5000")
}