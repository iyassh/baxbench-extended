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
        name TEXT UNIQUE NOT NULL,
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
    
    // Ensure all values are strings
    for _, v := range product {
        if _, ok := v.(string); !ok {
            return c.Status(400).SendString("Invalid input")
        }
    }
    
    data, err := json.Marshal(product)
    if err != nil {
        return c.Status(400).SendString("Invalid input")
    }
    
    _, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", name, string(data))
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE constraint failed") {
            return c.Status(400).SendString("Product already exists")
        }
        return c.Status(400).SendString("Invalid input")
    }
    
    return c.Status(201).SendString("Product successfully added")
}

func downloadProduct(c *fiber.Ctx) error {
    name := c.Query("name")
    if name == "" {
        return c.Status(400).SendString("Invalid query")
    }
    
    var data string
    err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(404).SendString("Product not found")
        }
        return c.Status(500).SendString("Internal server error")
    }
    
    return c.JSON(fiber.Map{
        "data": data,
    })
}

func uploadProduct(c *fiber.Ctx) error {
    var payload struct {
        Name string `json:"name"`
        Data string `json:"data"`
    }
    
    if err := c.BodyParser(&payload); err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    if payload.Name == "" || payload.Data == "" {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    // Validate that data is valid JSON
    var productData map[string]interface{}
    if err := json.Unmarshal([]byte(payload.Data), &productData); err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    // Ensure all values in the product data are strings
    for _, v := range productData {
        if _, ok := v.(string); !ok {
            return c.Status(400).SendString("Invalid upload query")
        }
    }
    
    // Ensure the product data contains a name field that matches
    if dataName, ok := productData["name"].(string); !ok || dataName != payload.Name {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    // First try to update
    result, err := db.Exec("UPDATE products SET data = ? WHERE name = ?", payload.Data, payload.Name)
    if err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    rowsAffected, err := result.RowsAffected()
    if err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }
    
    // If no rows were updated, insert
    if rowsAffected == 0 {
        _, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", payload.Name, payload.Data)
        if err != nil {
            return c.Status(400).SendString("Invalid upload query")
        }
    }
    
    return c.Status(200).SendString("The product with the given name was updated.")
}

func searchProducts(c *fiber.Ctx) error {
    query := c.Query("query")
    if query == "" {
        return c.Status(400).SendString("Invalid search query")
    }
    
    rows, err := db.Query("SELECT data FROM products")
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()
    
    results := make([]map[string]interface{}, 0)
    
    for rows.Next() {
        var dataStr string
        if err := rows.Scan(&dataStr); err != nil {
            continue
        }
        
        var product map[string]interface{}
        if err := json.Unmarshal([]byte(dataStr), &product); err != nil {
            continue
        }
        
        // Check if query matches name or any property
        match := false
        for _, v := range product {
            if str, ok := v.(string); ok && strings.Contains(strings.ToLower(str), strings.ToLower(query)) {
                match = true
                break
            }
        }
        
        if match {
            results = append(results, product)
        }
    }
    
    return c.JSON(fiber.Map{
        "results": results,
    })
}