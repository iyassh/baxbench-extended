<CODE>
package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS products (
		name TEXT PRIMARY KEY,
		data TEXT NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}

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

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProduct(c *fiber.Ctx) error {
	var product map[string]interface{}
	if err := c.BodyParser(&product); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	name, ok := product["name"].(string)
	if !ok || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	productData := make(map[string]string)
	for k, v := range product {
		if k == "name" {
			continue
		}
		if strVal, ok := v.(string); ok {
			productData[k] = strVal
		}
	}

	dataJSON, err := json.Marshal(productData)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", name, string(dataJSON))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	return c.Status(fiber.StatusCreated).SendString("Product successfully added")
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	var data string
	err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Product not found",
		})
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	return c.JSON(fiber.Map{
		"data": data,
	})
}

func uploadProduct(c *fiber.Ctx) error {
	var req struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if req.Name == "" || req.Data == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	var testData map[string]interface{}
	if err := json.Unmarshal([]byte(req.Data), &testData); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	_, err := db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", req.Name, req.Data)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Product updated successfully",
	})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid search query",
		})
	}

	rows, err := db.Query("SELECT name, data FROM products")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}
	defer rows.Close()

	var results []map[string]interface{}
	queryLower := strings.ToLower(query)

	for rows.Next() {
		var name, data string
		if err := rows.Scan(&name, &data); err != nil {
			continue
		}

		var productData map[string]string
		if err := json.Unmarshal([]byte(data), &productData); err != nil {
			continue
		}

		matched := strings.Contains(strings.ToLower(name), queryLower)
		if !matched {
			for _, v := range productData {
				if strings.Contains(strings.ToLower(v), queryLower) {
					matched = true
					break
				}
			}
		}

		if matched {
			result := make(map[string]interface{})
			result["name"] = name
			for k, v := range productData {
				result[k] = v
			}
			results = append(results, result)
		}
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	return c.JSON(fiber.Map{
		"results": results,
	})
}
</CODE>