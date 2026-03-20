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

    // Enable foreign keys
    if _, err = db.Exec("PRAGMA foreign_keys = ON"); err != nil {
        return err
    }

    // Create tables
    createProductsTable := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
    );`
    
    createPropertiesTable := `
    CREATE TABLE IF NOT EXISTS properties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE(product_id, key)
    );`
    
    if _, err = db.Exec(createProductsTable); err != nil {
        return err
    }
    
    if _, err = db.Exec(createPropertiesTable); err != nil {
        return err
    }
    
    return nil
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

func addProduct(c *fiber.Ctx) error {
    var data map[string]interface{}
    if err := c.BodyParser(&data); err != nil {
        return c.Status(400).SendString("Invalid input")
    }

    nameInterface, exists := data["name"]
    if !exists {
        return c.Status(400).SendString("Invalid input")
    }
    
    name, ok := nameInterface.(string)
    if !ok || name == "" {
        return c.Status(400).SendString("Invalid input")
    }

    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    defer tx.Rollback()

    result, err := tx.Exec("INSERT INTO products (name) VALUES (?)", name)
    if err != nil {
        if strings.Contains(err.Error(), "UNIQUE") {
            return c.Status(400).SendString("Invalid input")
        }
        return c.Status(500).SendString("Database error")
    }

    productID, err := result.LastInsertId()
    if err != nil {
        return c.Status(500).SendString("Database error")
    }

    for key, value := range data {
        if key != "name" {
            valueStr, ok := value.(string)
            if !ok {
                continue
            }
            if _, err := tx.Exec("INSERT INTO properties (product_id, key, value) VALUES (?, ?, ?)",
                productID, key, valueStr); err != nil {
                return c.Status(500).SendString("Database error")
            }
        }
    }

    if err := tx.Commit(); err != nil {
        return c.Status(500).SendString("Database error")
    }

    return c.Status(201).SendString("Product successfully added")
}

func downloadProduct(c *fiber.Ctx) error {
    name := c.Query("name")
    if name == "" {
        return c.Status(400).SendString("Name parameter is required")
    }

    var productID int64
    err := db.QueryRow("SELECT id FROM products WHERE name = ?", name).Scan(&productID)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.Status(404).SendString("Product not found")
        }
        return c.Status(500).SendString("Database error")
    }

    rows, err := db.Query("SELECT key, value FROM properties WHERE product_id = ?", productID)
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    defer rows.Close()

    productData := make(map[string]string)
    productData["name"] = name

    for rows.Next() {
        var key, value string
        if err := rows.Scan(&key, &value); err != nil {
            continue
        }
        productData[key] = value
    }

    dataBytes, err := json.Marshal(productData)
    if err != nil {
        return c.Status(500).SendString("Serialization error")
    }

    return c.JSON(fiber.Map{
        "data": string(dataBytes),
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

    var productData map[string]string
    if err := json.Unmarshal([]byte(request.Data), &productData); err != nil {
        return c.Status(400).SendString("Invalid upload query")
    }

    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    defer tx.Rollback()

    var productID int64
    err = tx.QueryRow("SELECT id FROM products WHERE name = ?", request.Name).Scan(&productID)
    if err != nil {
        if err == sql.ErrNoRows {
            result, err := tx.Exec("INSERT INTO products (name) VALUES (?)", request.Name)
            if err != nil {
                return c.Status(500).SendString("Database error")
            }
            productID, err = result.LastInsertId()
            if err != nil {
                return c.Status(500).SendString("Database error")
            }
        } else {
            return c.Status(500).SendString("Database error")
        }
    }

    if _, err = tx.Exec("DELETE FROM properties WHERE product_id = ?", productID); err != nil {
        return c.Status(500).SendString("Database error")
    }

    for key, value := range productData {
        if key != "name" {
            if _, err := tx.Exec("INSERT INTO properties (product_id, key, value) VALUES (?, ?, ?)",
                productID, key, value); err != nil {
                return c.Status(500).SendString("Database error")
            }
        }
    }

    if err := tx.Commit(); err != nil {
        return c.Status(500).SendString("Database error")
    }

    return c.SendString("The product with the given name was updated.")
}

func searchProducts(c *fiber.Ctx) error {
    query := c.Query("query")
    if query == "" {
        return c.Status(400).SendString("Invalid search query")
    }

    searchQuery := `
        SELECT DISTINCT p.id, p.name 
        FROM products p
        LEFT JOIN properties pr ON p.id = pr.product_id
        WHERE p.name LIKE ? OR pr.value LIKE ?
    `
    
    searchPattern := "%" + query + "%"
    rows, err := db.Query(searchQuery, searchPattern, searchPattern)
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    defer rows.Close()

    productIDsMap := make(map[int64]string)
    for rows.Next() {
        var id int64
        var name string
        if err := rows.Scan(&id, &name); err != nil {
            continue
        }
        productIDsMap[id] = name
    }

    results := make([]map[string]string, 0)
    for productID, productName := range productIDsMap {
        productData := make(map[string]string)
        productData["name"] = productName

        propRows, err := db.Query("SELECT key, value FROM properties WHERE product_id = ?", productID)
        if err != nil {
            continue
        }
        
        for propRows.Next() {
            var key, value string
            if err := propRows.Scan(&key, &value); err != nil {
                continue
            }
            productData[key] = value
        }
        propRows.Close()
        
        results = append(results, productData)
    }

    return c.JSON(fiber.Map{
        "results": results,
    })
}