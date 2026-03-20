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
        data TEXT NOT NULL
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

    // Add product endpoint
    app.Post("/add", func(c *fiber.Ctx) error {
        var productData map[string]interface{}
        if err := c.BodyParser(&productData); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
        }

        // Check if name exists
        nameInterface, exists := productData["name"]
        if !exists {
            return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
        }
        
        name, ok := nameInterface.(string)
        if !ok {
            return c.Status(400).JSON(fiber.Map{"error": "Name must be a string"})
        }

        // Convert all values to strings - as per OpenAPI spec, all properties should be strings
        stringData := make(map[string]string)
        for key, value := range productData {
            strValue, ok := value.(string)
            if !ok {
                return c.Status(400).JSON(fiber.Map{"error": "All properties must be strings"})
            }
            stringData[key] = strValue
        }

        // Store as JSON
        jsonData, err := json.Marshal(stringData)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Failed to process data"})
        }

        // Insert or replace product
        _, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", name, string(jsonData))
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Failed to add product"})
        }

        return c.SendStatus(201)
    })

    // Download product endpoint
    app.Get("/download", func(c *fiber.Ctx) error {
        name := c.Query("name")
        if name == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
        }

        var data string
        err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
        if err != nil {
            if err == sql.ErrNoRows {
                return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
            }
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }

        return c.JSON(fiber.Map{"data": data})
    })

    // Upload product endpoint
    app.Post("/upload", func(c *fiber.Ctx) error {
        var uploadData struct {
            Name string `json:"name"`
            Data string `json:"data"`
        }
        
        if err := c.BodyParser(&uploadData); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
        }

        if uploadData.Name == "" || uploadData.Data == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
        }

        // Validate that data is valid JSON
        var jsonCheck map[string]string
        if err := json.Unmarshal([]byte(uploadData.Data), &jsonCheck); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
        }

        // Update or insert product
        _, err := db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", uploadData.Name, uploadData.Data)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
        }

        return c.SendStatus(200)
    })

    // Search products endpoint
    app.Get("/search", func(c *fiber.Ctx) error {
        query := c.Query("query")
        if query == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
        }

        rows, err := db.Query("SELECT data FROM products")
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
        defer rows.Close()

        results := []map[string]string{}
        queryLower := strings.ToLower(query)

        for rows.Next() {
            var data string
            if err := rows.Scan(&data); err != nil {
                continue
            }

            var productData map[string]string
            if err := json.Unmarshal([]byte(data), &productData); err != nil {
                continue
            }

            // Check if query matches any field
            match := false
            for _, value := range productData {
                if strings.Contains(strings.ToLower(value), queryLower) {
                    match = true
                    break
                }
            }

            if match {
                results = append(results, productData)
            }
        }

        return c.JSON(fiber.Map{"results": results})
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}