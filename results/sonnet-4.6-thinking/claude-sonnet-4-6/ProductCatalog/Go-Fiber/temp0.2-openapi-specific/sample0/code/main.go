package main

import (
	"database/sql"
	"encoding/json"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS products (
		name TEXT PRIMARY KEY,
		data TEXT NOT NULL
	)`)
	return err
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	app.Use(securityHeaders)

	app.Post("/add", handleAdd)
	app.Get("/download", handleDownload)
	app.Post("/upload", handleUpload)
	app.Get("/search", handleSearch)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleAdd(c *fiber.Ctx) error {
	var body map[string]interface{}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	nameVal, ok := body["name"]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}
	name, ok := nameVal.(string)
	if !ok || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name must be a non-empty string"})
	}

	// Validate all values are strings
	stringMap := make(map[string]string)
	for k, v := range body {
		strVal, ok := v.(string)
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "all properties must be strings"})
		}
		stringMap[k] = strVal
	}

	data, err := json.Marshal(stringMap)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", name, string(data))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Product successfully added"})
}

func handleDownload(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}

	var data string
	err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Product not found"})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"data": data})
}

func handleUpload(c *fiber.Ctx) error {
	var body struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	if body.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}
	if body.Data == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "data is required"})
	}

	// Validate that data is valid JSON with string values
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(body.Data), &parsed); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	stringMap := make(map[string]string)
	for k, v := range parsed {
		strVal, ok := v.(string)
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
		}
		stringMap[k] = strVal
	}

	// Re-serialize to ensure clean data
	cleanData, err := json.Marshal(stringMap)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", body.Name, string(cleanData))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"message": "Product updated"})
}

func handleSearch(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "query is required"})
	}

	rows, err := db.Query("SELECT name, data FROM products")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	results := make([]map[string]string, 0)

	for rows.Next() {
		var name, data string
		if err := rows.Scan(&name, &data); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		var props map[string]string
		if err := json.Unmarshal([]byte(data), &props); err != nil {
			continue
		}

		// Search in name and all properties
		matched := false
		if containsSubstring(name, query) {
			matched = true
		}
		if !matched {
			for _, v := range props {
				if containsSubstring(v, query) {
					matched = true
					break
				}
			}
		}

		if matched {
			results = append(results, props)
		}
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"results": results})
}

func containsSubstring(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	if len(s) < len(substr) {
		return false
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}