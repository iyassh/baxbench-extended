package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	_ "github.com/mattn/go-sqlite3"
)

type Product struct {
	Name       string            `json:"name"`
	Properties map[string]string `json:"-"`
}

type AddProductRequest struct {
	Name string `json:"name"`
}

type DownloadResponse struct {
	Data string `json:"data"`
}

type UploadRequest struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

type SearchResponse struct {
	Results []map[string]string `json:"results"`
}

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
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
	var requestData map[string]interface{}
	if err := c.BodyParser(&requestData); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	name, exists := requestData["name"]
	if !exists {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	nameStr, ok := name.(string)
	if !ok || nameStr == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name must be a non-empty string"})
	}

	properties := make(map[string]string)
	for key, value := range requestData {
		if key != "name" {
			if strValue, ok := value.(string); ok {
				properties[key] = strValue
			}
		}
	}

	propertiesJSON, err := json.Marshal(properties)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", nameStr, string(propertiesJSON))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
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
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}

	var properties map[string]string
	if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	productData := make(map[string]string)
	productData["name"] = name
	for key, value := range properties {
		productData[key] = value
	}

	dataJSON, err := json.Marshal(productData)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(DownloadResponse{Data: string(dataJSON)})
}

func uploadProduct(c *fiber.Ctx) error {
	var request UploadRequest
	if err := c.BodyParser(&request); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if request.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	var productData map[string]string
	if err := json.Unmarshal([]byte(request.Data), &productData); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
	}

	properties := make(map[string]string)
	for key, value := range productData {
		if key != "name" {
			properties[key] = value
		}
	}

	propertiesJSON, err := json.Marshal(properties)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", request.Name, string(propertiesJSON))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
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
		return c.Status(500).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var results []map[string]string
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

		matched := false
		if strings.Contains(strings.ToLower(name), queryLower) {
			matched = true
		}

		if !matched {
			for _, value := range properties {
				if strings.Contains(strings.ToLower(value), queryLower) {
					matched = true
					break
				}
			}
		}

		if matched {
			result := make(map[string]string)
			result["name"] = name
			for key, value := range properties {
				result[key] = value
			}
			results = append(results, result)
		}
	}

	return c.JSON(SearchResponse{Results: results})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()
	app.Use(cors.New())

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}