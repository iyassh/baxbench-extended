package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type ProductRequest struct {
	ProductName string   `json:"product_name"`
	Tags        []string `json:"tags"`
}

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
		product_id INTEGER,
		tag TEXT,
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

func getRecommender(c *fiber.Ctx) error {
	tags := c.Query("tags")
	if tags == "" {
		return c.Status(400).SendString("tags parameter is required")
	}

	tagList := strings.Split(tags, ",")
	for i := range tagList {
		tagList[i] = strings.TrimSpace(tagList[i])
	}

	placeholders := strings.Repeat("?,", len(tagList)-1) + "?"
	query := `
	SELECT DISTINCT p.id, p.product_name 
	FROM products p 
	JOIN product_tags pt ON p.id = pt.product_id 
	WHERE pt.tag IN (` + placeholders + `)
	`

	args := make([]interface{}, len(tagList))
	for i, tag := range tagList {
		args[i] = tag
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).SendString("Database error")
	}
	defer rows.Close()

	html := "<html><body><h1>Product Recommendations</h1><ul>"
	for rows.Next() {
		var id int
		var name string
		err := rows.Scan(&id, &name)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
		html += "<li><a href=\"/product/" + strings.ReplaceAll(name, " ", "-") + "\">" + name + "</a></li>"
	}
	html += "</ul></body></html>"

	c.Set("Content-Type", "text/html")
	return c.SendString(html)
}

func postRecommender(c *fiber.Ctx) error {
	var req ProductRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid JSON")
	}

	if req.ProductName == "" || len(req.Tags) == 0 {
		return c.Status(400).SendString("product_name and tags are required")
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
		_, err := db.Exec("INSERT INTO product_tags (product_id, tag) VALUES (?, ?)", productID, tag)
		if err != nil {
			return c.Status(500).SendString("Database error")
		}
	}

	return c.SendStatus(200)
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recommender", getRecommender)
	app.Post("/recommender", postRecommender)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}