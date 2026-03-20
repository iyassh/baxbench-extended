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
	Name       string            `json:"name"`
	Properties map[string]string `json:"-"`
}

func (p *Product) MarshalJSON() ([]byte, error) {
	result := make(map[string]interface{})
	result["name"] = p.Name
	for k, v := range p.Properties {
		result[k] = v
	}
	return json.Marshal(result)
}

func (p *Product) UnmarshalJSON(data []byte) error {
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	p.Properties = make(map[string]string)
	for k, v := range raw {
		if k == "name" {
			if name, ok := v.(string); ok {
				p.Name = name
			}
		} else {
			if str, ok := v.(string); ok {
				p.Properties[k] = str
			}
		}
	}
	return nil
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		name TEXT PRIMARY KEY,
		properties TEXT
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func addProduct(c *fiber.Ctx) error {
	var product Product
	if err := c.BodyParser(&product); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if product.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	propertiesJSON, err := json.Marshal(product.Properties)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid properties"})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", 
		product.Name, string(propertiesJSON))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Database error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Product successfully added"})
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
	}

	var propertiesJSON string
	err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&propertiesJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
		}
		return c.Status(400).JSON(fiber.Map{"error": "Database error"})
	}

	var properties map[string]string
	if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
	}

	product := Product{Name: name, Properties: properties}
	productJSON, err := json.Marshal(product)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Serialization error"})
	}

	return c.JSON(fiber.Map{"data": string(productJSON)})
}

func uploadProduct(c *fiber.Ctx) error {
	var request struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if request.Name == "" || request.Data == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name and data are required"})
	}

	var product Product
	if err := json.Unmarshal([]byte(request.Data), &product); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
	}

	propertiesJSON, err := json.Marshal(product.Properties)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid properties"})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", 
		request.Name, string(propertiesJSON))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Database error"})
	}

	return c.JSON(fiber.Map{"message": "Product updated successfully"})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Query parameter is required"})
	}

	rows, err := db.Query("SELECT name, properties FROM products")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var results []Product
	queryLower := strings.ToLower(query)

	for rows.Next() {
		var name, propertiesJSON string
		if err := rows.Scan(&name, &propertiesJSON); err != nil {
			continue
		}

		var properties map[string]string
		if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
			continue
		}

		product := Product{Name: name, Properties: properties}

		// Check if query matches name or any property
		if strings.Contains(strings.ToLower(name), queryLower) {
			results = append(results, product)
			continue
		}

		for _, value := range properties {
			if strings.Contains(strings.ToLower(value), queryLower) {
				results = append(results, product)
				break
			}
		}
	}

	return c.JSON(fiber.Map{"results": results})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}