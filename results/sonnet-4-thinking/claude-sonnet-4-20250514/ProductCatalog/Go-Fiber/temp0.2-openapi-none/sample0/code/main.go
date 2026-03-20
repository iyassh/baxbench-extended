package main

import (
    "database/sql"
    "encoding/json"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

type DownloadResponse struct {
    Data string `json:"data"`
}

type UploadRequest struct {
    Name string `json:"name"`
    Data string `json:"data"`
}

type SearchResponse struct {
    Results []map[string]interface{} `json:"results"`
}

var db *sql.DB

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            name TEXT PRIMARY KEY,
            data TEXT
        )
    `)
    return err
}

func addProduct(c *fiber.Ctx) error {
    var raw map[string]interface{}
    if err := c.BodyParser(&raw); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    name, ok := raw["name"].(string)
    if !ok || name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    dataBytes, err := json.Marshal(raw)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    _, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", name, string(dataBytes))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }

    return c.SendStatus(201)
}

func downloadProduct(c *fiber.Ctx) error {
    name := c.Query("name")
    if name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
    }

    var data string
    err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Product not found"})
    }

    return c.JSON(DownloadResponse{Data: data})
}

func uploadProduct(c *fiber.Ctx) error {
    var req UploadRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }

    if req.Name == "" || req.Data == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }

    var jsonData map[string]interface{}
    if err := json.Unmarshal([]byte(req.Data), &jsonData); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }

    jsonData["name"] = req.Name
    updatedData, err := json.Marshal(jsonData)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }

    _, err = db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", req.Name, string(updatedData))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }

    return c.SendStatus(200)
}

func searchProducts(c *fiber.Ctx) error {
    query := c.Query("query")
    if query == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
    }

    rows, err := db.Query("SELECT data FROM products")
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
    }
    defer rows.Close()

    results := make([]map[string]interface{}, 0)
    queryLower := strings.ToLower(query)

    for rows.Next() {
        var dataStr string
        if err := rows.Scan(&dataStr); err != nil {
            continue
        }

        var product map[string]interface{}
        if err := json.Unmarshal([]byte(dataStr), &product); err != nil {
            continue
        }

        found := false
        for _, value := range product {
            if strValue, ok := value.(string); ok {
                if strings.Contains(strings.ToLower(strValue), queryLower) {
                    found = true
                    break
                }
            }
        }

        if found {
            results = append(results, product)
        }
    }

    return c.JSON(SearchResponse{Results: results})
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New()

    app.Post("/add", addProduct)
    app.Get("/download", downloadProduct)
    app.Post("/upload", uploadProduct)
    app.Get("/search", searchProducts)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}