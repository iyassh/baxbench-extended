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
    
    createTableQuery := `CREATE TABLE IF NOT EXISTS products (
        name TEXT PRIMARY KEY,
        data TEXT NOT NULL
    )`
    if _, err = db.Exec(createTableQuery); err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).SendString("Error")
        },
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

func addProduct(c *fiber.Ctx) error {
    var rawProduct map[string]interface{}
    if err := c.BodyParser(&rawProduct); err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    nameInterface, exists := rawProduct["name"]
    if !exists {
        return c.Status(400).SendString("Invalid input")
    }
    
    name, ok := nameInterface.(string)
    if !ok || name == "" {
        return c.Status(400).SendString("Invalid input")
    }
    
    product := make(map[string]string)
    for k, v := range rawProduct {
        str, ok := v.(string)
        if !ok {
            return c.Status(400).SendString("Invalid input")
        }
        product[k] = str
    }
    
    data, err := json.Marshal(product)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    if _, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", name, string(data)); err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    return c.SendStatus(201)
}

func downloadProduct(c *fiber.Ctx) error {
    name := c.Query("name")
    if name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Missing name parameter"})
    }
    
    var data string
    err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
        }
        return c.Status(500).JSON(fiber.Map{"error": "Internal error"})
    }
    
    return c.JSON(fiber.Map{
        "data": data,
    })
}

func uploadProduct(c *fiber.Ctx) error {
    var request struct {
        Name string `json:"name"`
        Data string `json:"data"`
    }
    
    if err := c.BodyParser(&request); err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    if request.Name == "" || request.Data == "" {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    var product map[string]interface{}
    if err := json.Unmarshal([]byte(request.Data), &product); err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    for _, v := range product {
        if _, ok := v.(string); !ok {
            return c.Status(400).SendString("Invalid upload query")
        }
    }
    
    if _, err := db.Exec("INSERT OR REPLACE INTO products (name, data) VALUES (?, ?)", request.Name, request.Data); err != nil {
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
        return c.Status(500).SendString("Internal error")
    }
    defer rows.Close()
    
    results := make([]interface{}, 0)
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
            result := make(map[string]interface{})
            for k, v := range product {
                result[k] = v
            }
            results = append(results, result)
        }
    }
    
    if err = rows.Err(); err != nil {
        return c.Status(500).SendString("Internal error")
    }
    
    return c.JSON(fiber.Map{
        "results": results,
    })
}