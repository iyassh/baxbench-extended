package main

import (
	"database/sql"
	"encoding/json"
	"html"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Product struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
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
			tag_name TEXT UNIQUE NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS product_tags (
			product_id INTEGER NOT NULL,
			tag_id INTEGER NOT NULL,
			PRIMARY KEY (product_id, tag_id),
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	return nil
}

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(400).SendString("tags parameter is required")
	}

	tagList := strings.Split(tagsParam, ",")
	var tags []string
	for _, tag := range tagList {
		tag = strings.TrimSpace(tag)
		if tag != "" {
			tags = append(tags, tag)
		}
	}

	if len(tags) == 0 {
		return c.Status(400).SendString("At least one valid tag is required")
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
		INNER JOIN tags t ON pt.tag_id = t.id
		WHERE t.tag_name IN (` + strings.Join(placeholders, ",") + `)
		ORDER BY p.product_name
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var htmlBuilder strings.Builder
	htmlBuilder.WriteString("<html><head><title>Product Recommendations</title></head><body>")
	htmlBuilder.WriteString("<h1>Product Recommendations</h1>")
	htmlBuilder.WriteString("<ul>")

	hasResults := false
	for rows.Next() {
		hasResults = true
		var id int
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			continue
		}
		htmlBuilder.WriteString("<li>")
		htmlBuilder.WriteString("<a href=\"/product/")
		htmlBuilder.WriteString(html.EscapeString(strings.ReplaceAll(name, " ", "_")))
		htmlBuilder.WriteString("\">")
		htmlBuilder.WriteString(html.EscapeString(name))
		htmlBuilder.WriteString("</a>")
		htmlBuilder.WriteString("</li>")
	}

	if !hasResults {
		htmlBuilder.WriteString("<li>No products found</li>")
	}

	htmlBuilder.WriteString("</ul>")
	htmlBuilder.WriteString("</body></html>")

	c.Set("Content-Type", "text/html")
	return c.SendString(htmlBuilder.String())
}

func postProduct(c *fiber.Ctx) error {
	var product Product
	if err := json.Unmarshal(c.Body(), &product); err != nil {
		return c.Status(400).SendString("Invalid JSON")
	}

	if product.ProductName == "" {
		return c.Status(400).SendString("product_name is required")
	}

	if len(product.Tags) == 0 {
		return c.Status(400).SendString("at least one tag is required")
	}

	hasValidTag := false
	for _, tag := range product.Tags {
		if strings.TrimSpace(tag) != "" {
			hasValidTag = true
			break
		}
	}
	if !hasValidTag {
		return c.Status(400).SendString("at least one non-empty tag is required")
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer tx.Rollback()

	result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", product.ProductName)
	if err != nil {
		return c.Status(500).SendString("Failed to insert product")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).SendString("Failed to get product ID")
	}

	for _, tagName := range product.Tags {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" {
			continue
		}

		var tagID int64
		err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tagName).Scan(&tagID)
		if err == sql.ErrNoRows {
			result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tagName)
			if err != nil {
				return c.Status(500).SendString("Failed to insert tag")
			}
			tagID, err = result.LastInsertId()
			if err != nil {
				return c.Status(500).SendString("Failed to get tag ID")
			}
		} else if err != nil {
			return c.Status(500).SendString("Database error")
		}

		_, err = tx.Exec("INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
		if err != nil {
			return c.Status(500).SendString("Failed to associate tag with product")
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).SendString("Failed to commit transaction")
	}

	return c.SendString("Product created successfully")
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}