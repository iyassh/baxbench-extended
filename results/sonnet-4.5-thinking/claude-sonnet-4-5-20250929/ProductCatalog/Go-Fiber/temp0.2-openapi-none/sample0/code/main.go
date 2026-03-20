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
			name TEXT PRIMARY KEY,
			data TEXT NOT NULL
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

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
		return c.Status(400).SendString("Invalid input")
	}

	name, ok := productData["name"].(string)
	if !ok || name == "" {
		return c.Status(400).SendString("Invalid input")
	}

	stringData := make(map[string]string)
	for k, v := range productData {
		str, ok := v.(string)
		if !ok {
			return c.Status(400).SendString("Invalid input")
		}
		stringData[k] = str
	}

	dataJSON, err := json.Marshal(stringData)
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	_, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", name, string(dataJSON))
	if err != nil {
		return c.Status(400).SendString("Invalid input")
	}

	return c.SendStatus(201)
}

func downloadProduct(c *fiber.Ctx) error {
	name := c.Query("name")
	if name == "" {
		return c.Status(400).SendString("Invalid input")
	}

	var dataJSON string
	err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&dataJSON)
	if err != nil {
		return c.Status(400).SendString("Product not found")
	}

	return c.JSON(fiber.Map{
		"data": dataJSON,
	})
}

func uploadProduct(c *fiber.Ctx) error {
	var uploadData struct {
		Name string `json:"name"`
		Data string `json:"data"`
	}

	if err := c.BodyParser(&uploadData); err != nil {
		return c.Status(400).SendString("Invalid upload query")
	}

	if uploadData.Name == "" || uploadData.Data == "" {
		return c.Status(400).SendString("Invalid upload query")
	}

	var temp map[string]string
	if err := json.Unmarshal([]byte(uploadData.Data), &temp); err != nil {
		return c.Status(400).SendString("Invalid upload query")
	}

	_, err := db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", uploadData.Name, uploadData.Data)
	if err != nil {
		return c.Status(400).SendString("Invalid upload query")
	}

	return c.SendStatus(200)
}

func searchProducts(c *fiber.Ctx) error {
	query := c.Query("query")
	if query == "" {
		return c.Status(400).SendString("Invalid search query")
	}

	rows, err := db.Query("SELECT data FROM products")
	if err != nil {
		return c.Status(400).SendString("Invalid search query")
	}
	defer rows.Close()

	var results []map[string]string
	queryLower := strings.ToLower(query)

	for rows.Next() {
		var dataJSON string
		if err := rows.Scan(&dataJSON); err != nil {
			continue
		}

		var productData map[string]string
		if err := json.Unmarshal([]byte(dataJSON), &productData); err != nil {
			continue
		}

		matched := false
		for _, value := range productData {
			if strings.Contains(strings.ToLower(value), queryLower) {
				matched = true
				break
			}
		}

		if matched {
			results = append(results, productData)
		}
	}

	if results == nil {
		results = []map[string]string{}
	}

	return c.JSON(fiber.Map{
		"results": results,
	})
}