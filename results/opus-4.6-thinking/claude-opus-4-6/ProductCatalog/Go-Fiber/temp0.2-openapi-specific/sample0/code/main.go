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

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	return c.Next()
}

func addProduct(c *fiber.Ctx) error {
	var body map[string]interface{}
	if err := json.Unmarshal(c.Body(), &body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON input"})
	}

	nameVal, ok := body["name"]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name is required"})
	}

	name, ok := nameVal.(string)
	if !ok || strings.TrimSpace(name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name must be a non-empty string"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	result, err := tx.Exec("INSERT INTO products (name) VALUES (?)", name)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	productID, err := result.LastInsertId()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	stmt, err := tx.Prepare("INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	for key, val := range body {
		if key == "name" {
			continue
		}
		valStr, ok := val.(string)
		if !ok {
			continue
		}
		_, err = stmt.Exec(productID, key, valStr)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	err = tx.Commit()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Product successfully added"})
}

func getProductData(name string) (map[string]interface{}, error) {
	row := db.QueryRow("SELECT id, name FROM products WHERE name = ?", name)
	var productID int64
	var productName string
	if err := row.Scan(&productID, &productName); err != nil {
		return nil, err
	}

	props := make(map[string]interface{})
	props["name"] = productName

	rows, err := db.Query("SELECT key, value FROM product_properties WHERE product_id = ?", productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		props[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return props, nil
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if strings.TrimSpace(name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name query parameter is required"})
	}

	productData, err := getProductData(name)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Product not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	dataBytes, err := json.Marshal(productData)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"data": string(dataBytes)})
}

func uploadProduct(c *fiber.Ctx) error {
	var body struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid JSON input"})
	}

	if strings.TrimSpace(body.Name) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name is required"})
	}

	if strings.TrimSpace(body.Data) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Data is required"})
	}

	var productData map[string]interface{}
	if err := json.Unmarshal([]byte(body.Data), &productData); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid data format"})
	}

	tx, err := db.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	// Find the product by name
	var productID int64
	row := tx.QueryRow("SELECT id FROM products WHERE name = ?", body.Name)
	if scanErr := row.Scan(&productID); scanErr != nil {
		if scanErr == sql.ErrNoRows {
			// Product doesn't exist, create it
			result, insertErr := tx.Exec("INSERT INTO products (name) VALUES (?)", body.Name)
			if insertErr != nil {
				err = insertErr
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
			productID, err = result.LastInsertId()
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
		} else {
			err = scanErr
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	// Update the product name if it's in the data
	if newName, ok := productData["name"]; ok {
		if newNameStr, ok := newName.(string); ok && strings.TrimSpace(newNameStr) != "" {
			_, err = tx.Exec("UPDATE products SET name = ? WHERE id = ?", newNameStr, productID)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
		}
	}

	// Delete all existing properties
	_, err = tx.Exec("DELETE FROM product_properties WHERE product_id = ?", productID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	// Insert new properties
	stmt, err := tx.Prepare("INSERT INTO product_properties (product_id, key, value) VALUES (?, ?, ?)")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	for key, val := range productData {
		if key == "name" {
			continue
		}
		valStr, ok := val.(string)
		if !ok {
			continue
		}
		_, err = stmt.Exec(productID, key, valStr)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
	}

	err = tx.Commit()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Product updated successfully"})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if strings.TrimSpace(query) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Query parameter is required"})
	}

	searchPattern := "%" + query + "%"

	// Find products where name matches or any property value matches
	rows, err := db.Query(`
		SELECT DISTINCT p.id, p.name 
		FROM products p
		LEFT JOIN product_properties pp ON p.id = pp.product_id
		WHERE p.name LIKE ? OR pp.value LIKE ?
	`, searchPattern, searchPattern)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	type productEntry struct {
		id   int64
		name string
	}

	var matchedProducts []productEntry
	for rows.Next() {
		var pe productEntry
		if err := rows.Scan(&pe.id, &pe.name); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		matchedProducts = append(matchedProducts, pe)
	}
	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	results := make([]map[string]string, 0)

	for _, pe := range matchedProducts {
		product := map[string]string{"name": pe.name}

		propRows, err := db.Query("SELECT key, value FROM product_properties WHERE product_id = ?", pe.id)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		for propRows.Next() {
			var key, value string
			if err := propRows.Scan(&key, &value); err != nil {
				propRows.Close()
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
			product[key] = value
		}
		if err := propRows.Err(); err != nil {
			propRows.Close()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		propRows.Close()

		results = append(results, product)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"results": results})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	app.Use(securityHeaders)

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}