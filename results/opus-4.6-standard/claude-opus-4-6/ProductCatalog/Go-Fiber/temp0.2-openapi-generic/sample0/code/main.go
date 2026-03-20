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
		CREATE INDEX IF NOT EXISTS idx_product_name ON products(name);
		CREATE INDEX IF NOT EXISTS idx_product_properties_product_id ON product_properties(product_id);
	`)
	if err != nil {
		log.Fatal(err)
	}
}

func getProductWithProperties(productID int64) (map[string]string, error) {
	result := make(map[string]string)

	var name string
	err := db.QueryRow("SELECT name FROM products WHERE id = ?", productID).Scan(&name)
	if err != nil {
		return nil, err
	}
	result["name"] = name

	rows, err := db.Query("SELECT key, value FROM product_properties WHERE product_id = ?", productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		result[k] = v
	}
	return result, rows.Err()
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// POST /add
	app.Post("/add", func(c *fiber.Ctx) error {
		var body map[string]interface{}
		if err := json.Unmarshal(c.Body(), &body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		nameVal, ok := body["name"]
		if !ok {
			return c.Status(400).JSON(fiber.Map{"error": "name is required"})
		}

		name, ok := nameVal.(string)
		if !ok || strings.TrimSpace(name) == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name must be a non-empty string"})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		res, err := tx.Exec("INSERT INTO products (name) VALUES (?)", name)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		productID, err := res.LastInsertId()
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		for key, val := range body {
			if key == "name" {
				continue
			}
			strVal, ok := val.(string)
			if !ok {
				tx.Rollback()
				return c.Status(400).JSON(fiber.Map{"error": "All additional properties must be strings"})
			}
			_, err := tx.Exec("INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)", productID, key, strVal)
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Product successfully added"})
	})

	// GET /download
	app.Get("/download", func(c *fiber.Ctx) error {
		name := c.Query("name")
		if strings.TrimSpace(name) == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name query parameter is required"})
		}

		rows, err := db.Query("SELECT id FROM products WHERE name = ?", name)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		var products []map[string]string
		for rows.Next() {
			var productID int64
			if err := rows.Scan(&productID); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			product, err := getProductWithProperties(productID)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			products = append(products, product)
		}
		if err := rows.Err(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		dataBytes, err := json.Marshal(products)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.Status(200).JSON(fiber.Map{"data": string(dataBytes)})
	})

	// POST /upload
	app.Post("/upload", func(c *fiber.Ctx) error {
		var body struct {
			Name string `json:"name"`
			Data string `json:"data"`
		}
		if err := json.Unmarshal(c.Body(), &body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if strings.TrimSpace(body.Name) == "" || strings.TrimSpace(body.Data) == "" {
			return c.Status(400).JSON(fiber.Map{"error": "name and data are required"})
		}

		var products []map[string]string
		if err := json.Unmarshal([]byte(body.Data), &products); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
		}

		tx, err := db.Begin()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		// Delete existing products with this name
		productRows, err := tx.Query("SELECT id FROM products WHERE name = ?", body.Name)
		if err != nil {
			tx.Rollback()
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		var existingIDs []int64
		for productRows.Next() {
			var pid int64
			if err := productRows.Scan(&pid); err != nil {
				productRows.Close()
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			existingIDs = append(existingIDs, pid)
		}
		productRows.Close()

		for _, pid := range existingIDs {
			_, err = tx.Exec("DELETE FROM product_properties WHERE product_id = ?", pid)
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			_, err = tx.Exec("DELETE FROM products WHERE id = ?", pid)
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
		}

		// Insert new products from data
		for _, product := range products {
			productName, ok := product["name"]
			if !ok {
				productName = body.Name
			}
			res, err := tx.Exec("INSERT INTO products (name) VALUES (?)", productName)
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			newID, err := res.LastInsertId()
			if err != nil {
				tx.Rollback()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			for key, val := range product {
				if key == "name" {
					continue
				}
				_, err := tx.Exec("INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)", newID, key, val)
				if err != nil {
					tx.Rollback()
					return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
				}
			}
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.Status(200).JSON(fiber.Map{"message": "Product updated"})
	})

	// GET /search
	app.Get("/search", func(c *fiber.Ctx) error {
		query := c.Query("query")
		if strings.TrimSpace(query) == "" {
			return c.Status(400).JSON(fiber.Map{"error": "query parameter is required"})
		}

		searchPattern := "%" + query + "%"

		// Find products matching by name or by any property value
		sqlQuery := `
			SELECT DISTINCT p.id FROM products p
			LEFT JOIN product_properties pp ON p.id = pp.product_id
			WHERE p.name LIKE ? OR pp.value LIKE ?
		`
		rows, err := db.Query(sqlQuery, searchPattern, searchPattern)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		var results []map[string]string
		for rows.Next() {
			var productID int64
			if err := rows.Scan(&productID); err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			product, err := getProductWithProperties(productID)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			results = append(results, product)
		}
		if err := rows.Err(); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		if results == nil {
			results = []map[string]string{}
		}

		return c.Status(200).JSON(fiber.Map{"results": results})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}