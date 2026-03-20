package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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

	name, ok := requestData["name"].(string)
	if !ok || name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
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

	stmt, err := db.Prepare("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(name, string(propertiesJSON))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Product added successfully"})
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
	}

	stmt, err := db.Prepare("SELECT properties FROM products WHERE name = ?")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	var propertiesJSON string
	err = stmt.QueryRow(name).Scan(&propertiesJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(DownloadResponse{Data: propertiesJSON})
}

func uploadProduct(c *fiber.Ctx) error {
	var req UploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
	}

	if req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
	}

	var properties map[string]string
	if err := json.Unmarshal([]byte(req.Data), &properties); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
	}

	stmt, err := db.Prepare("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(req.Name, req.Data)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.JSON(fiber.Map{"message": "Product updated successfully"})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Query parameter is required"})
	}

	stmt, err := db.Prepare("SELECT name, properties FROM products WHERE name LIKE ? OR properties LIKE ?")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	searchPattern := "%" + query + "%"
	rows, err := stmt.Query(searchPattern, searchPattern)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var results []map[string]string
	for rows.Next() {
		var name, propertiesJSON string
		if err := rows.Scan(&name, &propertiesJSON); err != nil {
			continue
		}

		var properties map[string]string
		if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
			continue
		}

		result := make(map[string]string)
		result["name"] = name
		for key, value := range properties {
			result[key] = value
		}

		if strings.Contains(strings.ToLower(name), strings.ToLower(query)) {
			results = append(results, result)
			continue
		}

		for _, value := range properties {
			if strings.Contains(strings.ToLower(value), strings.ToLower(query)) {
				results = append(results, result)
				break
			}
		}
	}

	return c.JSON(SearchResponse{Results: results})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(recover.New())

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}