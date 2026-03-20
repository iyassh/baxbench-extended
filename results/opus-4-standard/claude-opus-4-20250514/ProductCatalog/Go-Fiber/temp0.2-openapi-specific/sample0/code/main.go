package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	// Create products table
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		properties TEXT NOT NULL
	);`
	
	if _, err := db.Exec(createTableSQL); err != nil {
		log.Fatal(err)
	}
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	// Routes
	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProduct(c *fiber.Ctx) error {
	var productData map[string]interface{}
	if err := c.BodyParser(&productData); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Check if name exists
	nameInterface, exists := productData["name"]
	if !exists {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	name, ok := nameInterface.(string)
	if !ok || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Convert all values to strings
	properties := make(map[string]string)
	for key, value := range productData {
		if strValue, ok := value.(string); ok {
			properties[key] = strValue
		} else {
			properties[key] = fmt.Sprintf("%v", value)
		}
	}

	// Store as JSON
	propertiesJSON, err := json.Marshal(properties)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Insert into database using parameterized query
	_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	return c.SendStatus(fiber.StatusCreated)
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid query",
		})
	}

	var propertiesJSON string
	err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&propertiesJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "Product not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	return c.JSON(fiber.Map{
		"data": propertiesJSON,
	})
}

func uploadProduct(c *fiber.Ctx) error {
	var uploadData struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&uploadData); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
	}

	if uploadData.Name == "" || uploadData.Data == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
	}

	// Validate that data is valid JSON
	var properties map[string]string
	if err := json.Unmarshal([]byte(uploadData.Data), &properties); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
	}

	// Update or insert the product
	result, err := db.Exec("UPDATE products SET properties = ? WHERE name = ?", uploadData.Data, uploadData.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	if rowsAffected == 0 {
		// Product doesn't exist, insert it
		_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", uploadData.Name, uploadData.Data)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid upload query",
			})
		}
	}

	return c.SendStatus(fiber.StatusOK)
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid search query",
		})
	}

	// Search in name and properties
	rows, err := db.Query("SELECT name, properties FROM products WHERE name LIKE ? OR properties LIKE ?", 
		"%"+query+"%", "%"+query+"%")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
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

		results = append(results, properties)
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	return c.JSON(fiber.Map{
		"results": results,
	})
}