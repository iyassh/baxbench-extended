package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS product_properties (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
		);
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/add", handleAdd)
	app.Get("/download", handleDownload)
	app.Post("/upload", handleUpload)
	app.Get("/search", handleSearch)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleAdd(c *fiber.Ctx) error {
	var body map[string]interface{}
	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	nameVal, ok := body["name"]
	if !ok {
		return c.Status(400).JSON(fiber.Map{"error": "name is required"})
	}

	name, ok := nameVal.(string)
	if !ok || name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name must be a non-empty string"})
	}

	result, err := db.Exec("INSERT INTO products (name) VALUES (?)", name)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	for key, val := range body {
		if key == "name" {
			continue
		}
		strVal, ok := val.(string)
		if !ok {
			continue
		}
		_, err := db.Exec("INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)", productID, key, strVal)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}

	return c.Status(201).JSON(fiber.Map{"message": "Product successfully added"})
}

func handleDownload(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name is required"})
	}

	rows, err := db.Query("SELECT id FROM products WHERE name = ?", name)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var allProducts []map[string]string

	for rows.Next() {
		var productID int64
		if err := rows.Scan(&productID); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		product := map[string]string{"name": name}

		propRows, err := db.Query("SELECT key, value FROM product_properties WHERE product_id = ?", productID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		for propRows.Next() {
			var key, value string
			if err := propRows.Scan(&key, &value); err != nil {
				propRows.Close()
				return c.Status(500).JSON(fiber.Map{"error": err.Error()})
			}
			product[key] = value
		}
		propRows.Close()

		allProducts = append(allProducts, product)
	}

	dataBytes, err := json.Marshal(allProducts)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	return c.Status(200).JSON(fiber.Map{"data": string(dataBytes)})
}

func handleUpload(c *fiber.Ctx) error {
	var body struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if body.Name == "" || body.Data == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name and data are required"})
	}

	var products []map[string]string
	if err := json.Unmarshal([]byte(body.Data), &products); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
	}

	// Delete all existing products with this name
	rows, err := db.Query("SELECT id FROM products WHERE name = ?", body.Name)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		ids = append(ids, id)
	}
	rows.Close()

	for _, id := range ids {
		_, err := db.Exec("DELETE FROM product_properties WHERE product_id = ?", id)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		_, err = db.Exec("DELETE FROM products WHERE id = ?", id)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}

	// Insert new products from data
	for _, product := range products {
		productName := product["name"]
		if productName == "" {
			productName = body.Name
		}

		result, err := db.Exec("INSERT INTO products (name) VALUES (?)", productName)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		productID, err := result.LastInsertId()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		for key, val := range product {
			if key == "name" {
				continue
			}
			_, err := db.Exec("INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)", productID, key, val)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": err.Error()})
			}
		}
	}

	return c.Status(200).JSON(fiber.Map{"message": "The product with the given name was updated."})
}

func handleSearch(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).JSON(fiber.Map{"error": "query is required"})
	}

	searchPattern := "%" + strings.ToLower(query) + "%"

	sqlQuery := `
		SELECT DISTINCT p.id, p.name FROM products p
		LEFT JOIN product_properties pp ON p.id = pp.product_id
		WHERE LOWER(p.name) LIKE ? OR LOWER(pp.value) LIKE ? OR LOWER(pp.key) LIKE ?
	`

	rows, err := db.Query(sqlQuery, searchPattern, searchPattern, searchPattern)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var results []map[string]string

	for rows.Next() {
		var productID int64
		var name string
		if err := rows.Scan(&productID, &name); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		product := map[string]string{"name": name}

		propRows, err := db.Query("SELECT key, value FROM product_properties WHERE product_id = ?", productID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}

		for propRows.Next() {
			var key, value string
			if err := propRows.Scan(&key, &value); err != nil {
				propRows.Close()
				return c.Status(500).JSON(fiber.Map{"error": err.Error()})
			}
			product[key] = value
		}
		propRows.Close()

		results = append(results, product)
	}

	if results == nil {
		results = []map[string]string{}
	}

	return c.Status(200).JSON(fiber.Map{"results": results})
}