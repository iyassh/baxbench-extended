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

type ProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
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
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(400).SendString("Tags parameter is required")
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

	query := fmt.Sprintf(`
		SELECT DISTINCT p.id, p.product_name
		FROM products p
		JOIN product_tags pt ON p.id = pt.product_id
		JOIN tags t ON pt.tag_id = t.id
		WHERE t.tag_name IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var products []struct {
		ID          int
		ProductName string
	}

	for rows.Next() {
		var product struct {
			ID          int
			ProductName string
		}
		if err := rows.Scan(&product.ID, &product.ProductName); err != nil {
			continue
		}
		products = append(products, product)
	}

	html := "<html><body><h1>Recommended Products</h1>"
	if len(products) == 0 {
		html += "<p>No products found for the given tags.</p>"
	} else {
		html += "<ul>"
		for _, product := range products {
			html += fmt.Sprintf("<li>%s</li>", product.ProductName)
		}
		html += "</ul>"
	}
	html += "</body></html>"

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postProduct(c *fiber.Ctx) error {
	var req ProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.ProductName == "" || len(req.Tags) == 0 {
		return c.Status(400).SendString("Invalid input")
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	for _, tagName := range req.Tags {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" {
			continue
		}

		var tagID int64
		err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tagName).Scan(&tagID)
		if err == sql.ErrNoRows {
			result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tagName)
			if err != nil {
				return c.Status(500).SendString("Database error")
			}
			tagID, err = result.LastInsertId()
			if err != nil {
				return c.Status(500).SendString("Database error")
			}
		} else if err != nil {
			return c.Status(500).SendString("Database error")
		}

		_, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).SendString("Database error")
	}

	return c.SendStatus(200)
}