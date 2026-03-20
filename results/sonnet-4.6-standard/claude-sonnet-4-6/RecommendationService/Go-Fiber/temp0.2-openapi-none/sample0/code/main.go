package main

import (
	"database/sql"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createProductsTable := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_name TEXT NOT NULL
	);`

	createTagsTable := `
	CREATE TABLE IF NOT EXISTS product_tags (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		product_id INTEGER NOT NULL,
		tag TEXT NOT NULL,
		FOREIGN KEY (product_id) REFERENCES products(id)
	);`

	_, err = db.Exec(createProductsTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(createTagsTable)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", func(c *fiber.Ctx) error {
		tagsParam := c.Query("tags")
		if tagsParam == "" {
			return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
		}

		tags := strings.Split(tagsParam, ",")
		for i, tag := range tags {
			tags[i] = strings.TrimSpace(tag)
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
			return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
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
				return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
			}
			products = append(products, p)
		}

		var sb strings.Builder
		sb.WriteString("<html><body><ul>")
		for _, p := range products {
			sb.WriteString(fmt.Sprintf(`<li><a href="/product/%d">%s</a></li>`, p.ID, p.Name))
		}
		sb.WriteString("</ul></body></html>")

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
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if body.ProductName == "" {
			return c.Status(fiber.StatusBadRequest).SendString("product_name is required")
		}

		result, err := db.Exec("INSERT INTO products (product_name) VALUES (?)", body.ProductName)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
		}

		productID, err := result.LastInsertId()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
		}

		for _, tag := range body.Tags {
			tag = strings.TrimSpace(tag)
			if tag == "" {
				continue
			}
			_, err := db.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, tag)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
			}
		}

		return c.SendStatus(fiber.StatusOK)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}