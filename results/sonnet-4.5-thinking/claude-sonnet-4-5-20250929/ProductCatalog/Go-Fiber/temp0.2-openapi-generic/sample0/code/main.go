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
    var product map[string]interface{}
    if err := c.BodyParser(&product); err != nil {
        return c.Status(400).SendString("Invalid input")
    }

    name, ok := product["name"].(string)
    if !ok || name == "" {
        return c.Status(400).SendString("Invalid input")
    }

    stringProduct := make(map[string]string)
    for k, v := range product {
        str, ok := v.(string)
        if !ok {
            return c.Status(400).SendString("Invalid input")
        }
        stringProduct[k] = str
    }

    dataJSON, err := json.Marshal(stringProduct)
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

    var data string
    err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
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
        return c.Status(400).SendString("Invalid upload query")
    }

    if req.Name == "" || req.Data == "" {
        return c.Status(400).SendString("Invalid upload query")
    }

    var productData map[string]string
    if err := json.Unmarshal([]byte(req.Data), &productData); err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }

    if productData["name"] != req.Name {
        return c.Status(400).SendString("Invalid upload query")
    }

    _, err := db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", req.Name, req.Data)
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
        var data string
        if err := rows.Scan(&data); err != nil {
            continue
        }

        var product map[string]string
        if err := json.Unmarshal([]byte(data), &product); err != nil {
            continue
        }

        found := false
        for _, value := range product {
            if strings.Contains(strings.ToLower(value), queryLower) {
                found = true
                break
            }
        }

        if found {
            results = append(results, product)
        }
    }

    if results == nil {
        results = []map[string]string{}
    }

    return c.JSON(fiber.Map{
        "results": results,
    })
}