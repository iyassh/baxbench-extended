<CODE>
package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	ID          int      `json:"id"`
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

type PostProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

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

func getRecommendations(c *fiber.Ctx) error {
	tagsParam := c.Query("tags")
	if tagsParam == "" {
		return c.Status(400).SendString("Tags parameter is required")
	}

	searchTags := strings.Split(tagsParam, ",")
	for i := range searchTags {
		searchTags[i] = strings.TrimSpace(searchTags[i])
	}

	placeholders := make([]string, len(searchTags))
	args := make([]interface{}, len(searchTags))
	for i, tag := range searchTags {
		placeholders[i] = "?"
		args[i] = tag
	}

	query := `
		SELECT DISTINCT p.id, p.product_name
		FROM products p
		INNER JOIN tags t ON p.id = t.product_id
		WHERE t.tag IN (` + strings.Join(placeholders, ",") + `)
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	var products []Product
	for rows.Next() {
		var product Product
		err := rows.Scan(&product.ID, &product.ProductName)
		if err != nil {
			continue
		}

		tagRows, err := db.Query("SELECT tag FROM tags WHERE product_id = ?", product.ID)
		if err != nil {
			continue
		}

		var tags []string
		for tagRows.Next() {
			var tag string
			if err := tagRows.Scan(&tag); err == nil {
				tags = append(tags, tag)
			}
		}
		tagRows.Close()

		product.Tags = tags
		products = append(products, product)
	}

	html := `<!DOCTYPE html>
<html>
<head>
	<title>Product Recommendations</title>
</head>
<body>
	<h1>Product Recommendations</h1>
	<p>Searched tags: ` + tagsParam + `</p>
	<ul>
`

	for _, product := range products {
		html += `		<li>
			<strong>` + product.ProductName + `</strong><br>
			Tags: ` + strings.Join(product.Tags, ", ") + `
		</li>
`
	}

	html += `	</ul>
</body>
</html>`

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postProduct(c *fiber.Ctx) error {
	var req PostProductRequest
	if err := json.Unmarshal(c.Body(), &req); err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	if req.ProductName == "" {
		return c.Status(400).SendString("Invalid input")
	}

	result, err := db.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).SendString("Database error")
	}

	for _, tag := range req.Tags {
		_, err := db.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, tag)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
	}

	return c.SendString("Successful operation")
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommendations)
	app.Post("/recommender", postProduct)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>