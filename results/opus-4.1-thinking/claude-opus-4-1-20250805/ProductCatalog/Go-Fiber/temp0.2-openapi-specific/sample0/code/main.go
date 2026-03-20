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

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }
    
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        properties TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_name ON products(name);
    `
    
    _, err = db.Exec(createTableSQL)
    return err
}

func addSecurityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.Next()
}

func handleAdd(c *fiber.Ctx) error {
    var data map[string]string
    if err := c.BodyParser(&data); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }
    
    name, exists := data["name"]
    if !exists || name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
    }
    
    // Remove name from data to get just the additional properties
    delete(data, "name")
    
    propertiesJSON, err := json.Marshal(data)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }
    
    _, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE constraint failed") {
            return c.Status(400).JSON(fiber.Map{"error": "Product already exists"})
        }
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }
    
    return c.SendStatus(201)
}

func handleDownload(c *fiber.Ctx) error {
    name := c.Query("name")
    if name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
    }
    
    var properties string
    err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&properties)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
        }
        return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
    }
    
    // Parse properties and add name
    var props map[string]string
    if err := json.Unmarshal([]byte(properties), &props); err != nil {
        props = make(map[string]string)
    }
    props["name"] = name
    
    dataJSON, err := json.Marshal(props)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
    }
    
    return c.JSON(fiber.Map{"data": string(dataJSON)})
}

func handleUpload(c *fiber.Ctx) error {
    var request struct {
        Name string `json:"name"`
        Data string `json:"data"`
    }
    
    if err := c.BodyParser(&request); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }
    
    if request.Name == "" || request.Data == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }
    
    // Parse the data string as JSON
    var data map[string]string
    if err := json.Unmarshal([]byte(request.Data), &data); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }
    
    // Remove name from properties if it exists
    delete(data, "name")
    
    propertiesJSON, err := json.Marshal(data)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid upload query"})
    }
    
    // Update or insert the product
    result, err := db.Exec("UPDATE products SET properties = ? WHERE name = ?", string(propertiesJSON), request.Name)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
    }
    
    rowsAffected, _ := result.RowsAffected()
    if rowsAffected == 0 {
        // Product doesn't exist, insert it
        _, err = db.Exec("INSERT INTO products (name, properties) VALUES (?, ?)", request.Name, string(propertiesJSON))
        if err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
        }
    }
    
    return c.SendStatus(200)
}

func handleSearch(c *fiber.Ctx) error {
    query := c.Query("query")
    if query == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid search query"})
    }
    
    // Search in name and properties
    searchSQL := `
        SELECT name, properties 
        FROM products 
        WHERE name LIKE ? OR properties LIKE ?
    `
    
    searchPattern := "%" + query + "%"
    rows, err := db.Query(searchSQL, searchPattern, searchPattern)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "An error occurred"})
    }
    defer rows.Close()
    
    results := []map[string]string{}
    for rows.Next() {
        var name, properties string
        if err := rows.Scan(&name, &properties); err != nil {
            continue
        }
        
        var props map[string]string
        if err := json.Unmarshal([]byte(properties), &props); err != nil {
            props = make(map[string]string)
        }
        
        // Add name to properties
        props["name"] = name
        results = append(results, props)
    }
    
    return c.JSON(fiber.Map{"results": results})
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database")
    }
    defer db.Close()
    
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
        },
    })
    
    app.Use(addSecurityHeaders)
    
    app.Post("/add", handleAdd)
    app.Get("/download", handleDownload)
    app.Post("/upload", handleUpload)
    app.Get("/search", handleSearch)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}