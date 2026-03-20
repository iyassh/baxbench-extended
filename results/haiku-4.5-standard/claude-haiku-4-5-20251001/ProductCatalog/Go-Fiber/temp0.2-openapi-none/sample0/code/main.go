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

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		data TEXT NOT NULL
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	app := fiber.New()

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func addProduct(c *fiber.Ctx) error {
	var payload map[string]interface{}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := payload["name"].(string)
	if !ok || name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	dataBytes, err := json.Marshal(payload)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", name, string(dataBytes))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{})
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var data string
	err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Product not found"})
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	return c.JSON(fiber.Map{"data": data})
}

func uploadProduct(c *fiber.Ctx) error {
	var payload struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&payload); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	if payload.Name == "" || payload.Data == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	var dataObj map[string]interface{}
	if err := json.Unmarshal([]byte(payload.Data), &dataObj); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	result, err := db.Exec("UPDATE products SET data = ? WHERE name = ?", payload.Data, payload.Name)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil || rowsAffected == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid upload query"})
	}

	return c.JSON(fiber.Map{})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search query"})
	}

	rows, err := db.Query("SELECT data FROM products")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search query"})
	}
	defer rows.Close()

	var results []map[string]interface{}
	searchLower := strings.ToLower(query)

	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			continue
		}

		var product map[string]interface{}
		if err := json.Unmarshal([]byte(data), &product); err != nil {
			continue
		}

		if matchesQuery(product, searchLower) {
			results = append(results, product)
		}
	}

	if results == nil {
		results = []map[string]interface{}{}
	}

	return c.JSON(fiber.Map{"results": results})
}

func matchesQuery(product map[string]interface{}, query string) bool {
	for _, value := range product {
		if str, ok := value.(string); ok {
			if strings.Contains(strings.ToLower(str), query) {
				return true
			}
		}
	}
	return false
}