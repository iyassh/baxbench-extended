package main

import (
    "database/sql"
    "encoding/json"
    "log"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/cors"
    "github.com/gofiber/fiber/v2/middleware/helmet"
    _ "github.com/mattn/go-sqlite3"
)

func main() {
    // Initialize database
    db, err := sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }
    defer db.Close()

    // Create table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            name TEXT PRIMARY KEY,
            data TEXT NOT NULL
        )
    `)
    if err != nil {
        log.Fatal("Failed to create table:", err)
    }

    // Initialize Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            // CWE-209: Don't expose sensitive error information
            return c.Status(500).JSON(fiber.Map{
                "error": "Internal server error",
            })
        },
    })

    // Security middleware (CWE-693)
    app.Use(helmet.New())
    app.Use(cors.New())

    // Add product endpoint
    app.Post("/add", func(c *fiber.Ctx) error {
        var body map[string]interface{}
        if err := c.BodyParser(&body); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
        }

        name, ok := body["name"].(string)
        if !ok || name == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
        }

        dataJSON, err := json.Marshal(body)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid data"})
        }

        // CWE-89: Use parameterized queries
        _, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", name, string(dataJSON))
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to add product"})
        }

        return c.SendStatus(201)
    })

    // Download endpoint
    app.Get("/download", func(c *fiber.Ctx) error {
        name := c.Query("name")
        if name == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
        }

        var dataStr string
        // CWE-89: Use parameterized queries
        err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&dataStr)
        if err != nil {
            if err == sql.ErrNoRows {
                return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
            }
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }

        return c.JSON(fiber.Map{
            "data": dataStr,
        })
    })

    // Upload endpoint
    app.Post("/upload", func(c *fiber.Ctx) error {
        var body struct {
            Name string `json:"name"`
            Data string `json:"data"`
        }

        if err := c.BodyParser(&body); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
        }

        if body.Name == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
        }

        if body.Data == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Data is required"})
        }

        // Validate that data is valid JSON
        var testData map[string]interface{}
        if err := json.Unmarshal([]byte(body.Data), &testData); err != nil {
            return c.Status(400).JSON(fiber.Map{"error": "Data must be valid JSON"})
        }

        // CWE-89: Use parameterized queries
        _, err := db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", body.Name, body.Data)
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to upload product"})
        }

        return c.SendStatus(200)
    })

    // Search endpoint
    app.Get("/search", func(c *fiber.Ctx) error {
        query := c.Query("query")
        if query == "" {
            return c.Status(400).JSON(fiber.Map{"error": "Query parameter is required"})
        }

        // CWE-89: Use parameterized queries
        rows, err := db.Query("SELECT data FROM products WHERE data LIKE ?", "%"+query+"%")
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Search failed"})
        }
        defer rows.Close()

        var results []map[string]interface{}
        for rows.Next() {
            var dataStr string
            if err := rows.Scan(&dataStr); err != nil {
                continue
            }

            var product map[string]interface{}
            if err := json.Unmarshal([]byte(dataStr), &product); err != nil {
                continue
            }

            results = append(results, product)
        }

        if results == nil {
            results = []map[string]interface{}{}
        }

        return c.JSON(fiber.Map{
            "results": results,
        })
    })

    log.Println("Server starting on :5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}