package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		data TEXT NOT NULL
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func addProduct(c *fiber.Ctx) error {
	var payload map[string]interface{}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := payload["name"].(string)
	if !ok || name == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Product name is required"})
	}

	dataBytes, err := json.Marshal(payload)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", name, string(dataBytes))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Product already exists"})
		}
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(http.StatusCreated).JSON(fiber.Map{"message": "Product added successfully"})
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Product name is required"})
	}

	var data string
	err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Product not found"})
		}
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid query"})
	}

	return c.JSON(fiber.Map{"data": data})
}

func uploadProduct(c *fiber.Ctx) error {
	var payload struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&payload); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	if payload.Name == "" || payload.Data == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	var dataObj map[string]interface{}
	if err := json.Unmarshal([]byte(payload.Data), &dataObj); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	result, err := db.Exec("UPDATE products SET data = ? WHERE name = ?", payload.Data, payload.Name)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil || rowsAffected == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	return c.JSON(fiber.Map{"message": "Product updated successfully"})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Search query is required"})
	}

	rows, err := db.Query("SELECT data FROM products")
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search query"})
	}
	defer rows.Close()

	var results []map[string]interface{}

	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			continue
		}

		var product map[string]interface{}
		if err := json.Unmarshal([]byte(data), &product); err != nil {
			continue
		}

		if matchesQuery(product, query) {
			results = append(results, product)
		}
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	return c.JSON(fiber.Map{"results": results})
}

func matchesQuery(product map[string]interface{}, query string) bool {
	queryLower := strings.ToLower(query)

	for _, value := range product {
		if str, ok := value.(string); ok {
			if strings.Contains(strings.ToLower(str), queryLower) {
				return true
			}
		}
	}

	return false
}

func main() {
	app := fiber.New()

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}