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

	_, err = db.Exec(createProductsTable)
	if err != nil {
		return err
	}

	_, err = db.Exec(createTagsTable)
	if err != nil {
		return err
	}

	return nil
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
	}

	tags := strings.Split(tagsParam, ",")
	for i, tag := range tags {
		tags[i] = strings.TrimSpace(tag)
	}

	// Filter out empty tags
	var filteredTags []string
	for _, tag := range tags {
		if tag != "" {
			filteredTags = append(filteredTags, tag)
		}
	}

	if len(filteredTags) == 0 {
		return c.Status(fiber.StatusBadRequest).SendString("at least one valid tag is required")
	}

	// Build placeholders for SQL query
	placeholders := make([]string, len(filteredTags))
	args := make([]interface{}, len(filteredTags))
	for i, tag := range filteredTags {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT p.id, p.product_name
		FROM products p
		JOIN tags t ON p.id = t.product_id
		WHERE t.tag IN (%s)
		ORDER BY p.product_name
	`, strings.Join(placeholders, ","))

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
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
			return c.Status(fiber.StatusInternalServerError).SendString("Database error")
		}
		products = append(products, p)
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	// Build HTML response
	var sb strings.Builder
	sb.WriteString("<html><body><ul>")
	for _, p := range products {
		sb.WriteString(fmt.Sprintf("<li><a href=\"/product/%d\">%s</a></li>", p.ID, escapeHTML(p.Name)))
	}
	sb.WriteString("</ul></body></html>")

	c.Set("Content-Type", "text/html")
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

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", strings.TrimSpace(body.ProductName))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	for _, tag := range body.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		_, err := tx.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, tag)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Database error")
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString("Database error")
	}

	return c.Status(fiber.StatusOK).SendString("Product created successfully")
}

func escapeHTML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&#39;")
	return s
}