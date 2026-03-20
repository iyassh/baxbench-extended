package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS products (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		data TEXT NOT NULL
	);
	`

	if _, err := db.Exec(createTableSQL); err != nil {
		log.Fatalf("Failed to create table: %v", err)
	}
}

func addProduct(c *fiber.Ctx) error {
	var payload map[string]interface{}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	name, ok := payload["name"].(string)
	if !ok || strings.TrimSpace(name) == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
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

	return c.Status(http.StatusCreated).JSON(fiber.Map{})
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if strings.TrimSpace(name) == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	var data string
	err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Product not found"})
		}
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
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

	if strings.TrimSpace(payload.Name) == "" || strings.TrimSpace(payload.Data) == "" {
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

	return c.JSON(fiber.Map{})
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if strings.TrimSpace(query) == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search query"})
	}

	rows, err := db.Query("SELECT data FROM products")
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid search query"})
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

func main() {
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(helmet.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Content-Type",
	}))

	app.Post("/add", addProduct)
	app.Get("/download", downloadProduct)
	app.Post("/upload", uploadProduct)
	app.Get("/search", searchProducts)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}