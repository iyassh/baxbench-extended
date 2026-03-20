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

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		properties TEXT NOT NULL
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

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProduct(c *fiber.Ctx) error {
	var productData map[string]interface{}
	if err := c.BodyParser(&productData); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := productData["name"].(string)
	if !ok || name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	// Convert all properties to strings
	properties := make(map[string]string)
	for key, value := range productData {
		if key != "name" {
			properties[key] = convertToString(value)
		}
	}

	propertiesJSON, err := json.Marshal(properties)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid properties"})
	}

	_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(400).JSON(fiber.Map{"error": "Product already exists"})
		}
		return c.Status(400).JSON(fiber.Map{"error": "Failed to add product"})
	}

	return c.SendStatus(201)
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

	// Create the data string in the format: name + properties JSON
	data := name + "|" + propertiesJSON

	return c.JSON(fiber.Map{"data": data})
}

func uploadProduct(c *fiber.Ctx) error {
	var uploadData struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&uploadData); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	if uploadData.Name == "" || uploadData.Data == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name and data are required"})
	}

	// Parse the data string
	parts := strings.SplitN(uploadData.Data, "|", 2)
	if len(parts) != 2 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
	}

	storedName := parts[0]
	propertiesJSON := parts[1]

	// Verify the name matches
	if storedName != uploadData.Name {
		return c.Status(400).JSON(fiber.Map{"error": "Name mismatch in data"})
	}

	// Validate JSON
	var properties map[string]string
	if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid properties JSON"})
	}

	// Update or insert the product
	_, err := db.Exec(`
		INSERT INTO products (name, properties) VALUES (?, ?)
		ON CONFLICT(name) DO UPDATE SET properties = excluded.properties
	`, uploadData.Name, propertiesJSON)
	
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to update product"})
	}

	return c.SendStatus(200)
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

		// Check if name matches
		if strings.Contains(strings.ToLower(name), queryLower) {
			result := make(map[string]string)
			result["name"] = name

			var properties map[string]string
			if err := json.Unmarshal([]byte(propertiesJSON), &properties); err == nil {
				for k, v := range properties {
					result[k] = v
				}
			}
			results = append(results, result)
			continue
		}

		// Check if any property matches
		var properties map[string]string
		if err := json.Unmarshal([]byte(propertiesJSON), &properties); err == nil {
			found := false
			for _, v := range properties {
				if strings.Contains(strings.ToLower(v), queryLower) {
					found = true
					break
				}
			}
			if found {
				result := make(map[string]string)
				result["name"] = name
				for k, v := range properties {
					result[k] = v
				}
				results = append(results, result)
			}
		}
	}

	if results == nil {
		results = []map[string]string{}
	}

	return c.JSON(fiber.Map{"results": results})
}

func convertToString(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return json.Number(val).String()
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		bytes, _ := json.Marshal(val)
		return string(bytes)
	}
}