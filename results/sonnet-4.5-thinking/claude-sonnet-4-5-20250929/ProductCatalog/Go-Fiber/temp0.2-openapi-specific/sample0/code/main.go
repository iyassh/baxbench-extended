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

func main() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL,
			properties TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

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

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.Status(code).JSON(fiber.Map{
		"error": "An error occurred",
	})
}

func addProduct(c *fiber.Ctx) error {
	var data map[string]interface{}
	if err := c.BodyParser(&data); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	name, ok := data["name"].(string)
	if !ok || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	properties := make(map[string]string)
	for key, value := range data {
		if key != "name" {
			strValue, ok := value.(string)
			if !ok {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "Invalid input",
				})
			}
			properties[key] = strValue
		}
	}

	propertiesJSON, err := json.Marshal(properties)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	_, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
	if err != nil {
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
			"error": "Invalid input",
		})
	}

	var properties string
	err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&properties)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Product not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	return c.JSON(fiber.Map{
		"data": properties,
	})
}

func uploadProduct(c *fiber.Ctx) error {
	var input struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}
	if err := c.BodyParser(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
	}

	if input.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
	}

	var testJSON map[string]string
	if err := json.Unmarshal([]byte(input.Data), &testJSON); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
	}

	_, err := db.Exec(`
		INSERT INTO products (name, properties) VALUES (?, ?) 
		ON CONFLICT(name) DO UPDATE SET properties = excluded.properties
	`, input.Name, input.Data)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid upload query",
		})
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

	rows, err := db.Query("SELECT name, properties FROM products")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}
	defer rows.Close()

	var results []map[string]string
	queryLower := strings.ToLower(query)

	for rows.Next() {
		var name, properties string
		if err := rows.Scan(&name, &properties); err != nil {
			continue
		}

		var props map[string]string
		if err := json.Unmarshal([]byte(properties), &props); err != nil {
			continue
		}

		matched := false
		if strings.Contains(strings.ToLower(name), queryLower) {
			matched = true
		} else {
			for _, value := range props {
				if strings.Contains(strings.ToLower(value), queryLower) {
					matched = true
					break
				}
			}
		}

		if matched {
			result := map[string]string{"name": name}
			for k, v := range props {
				result[k] = v
			}
			results = append(results, result)
		}
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "An error occurred",
		})
	}

	if results == nil {
		results = []map[string]string{}
	}

	return c.JSON(fiber.Map{
		"results": results,
	})
}