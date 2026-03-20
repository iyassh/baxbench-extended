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

    createTable := `
    CREATE TABLE IF NOT EXISTS products (
        name TEXT PRIMARY KEY,
        data TEXT NOT NULL
    );`
    
    if _, err := db.Exec(createTable); err != nil {
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
        return c.SendStatus(400)
    }

    // Check if name exists
    nameRaw, exists := product["name"]
    if !exists {
        return c.SendStatus(400)
    }
    
    name, ok := nameRaw.(string)
    if !ok || name == "" {
        return c.SendStatus(400)
    }

    // Ensure all properties are strings
    for _, value := range product {
        if _, ok := value.(string); !ok {
            return c.SendStatus(400)
        }
    }

    // Convert to JSON for storage
    data, err := json.Marshal(product)
    if err != nil {
        return c.SendStatus(400)
    }

    // Insert into database
    _, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", name, string(data))
    if err != nil {
        return c.SendStatus(400)
    }

    return c.SendStatus(201)
}

func downloadProduct(c *fiber.Ctx) error {
    name := c.Query("name")
    if name == "" {
        return c.SendStatus(400)
    }

    var data string
    err := db.QueryRow("SELECT data FROM products WHERE name = ?", name).Scan(&data)
    if err != nil {
        if err == sql.ErrNoRows {
            return c.SendStatus(404)
        }
        return c.SendStatus(500)
    }

    return c.JSON(fiber.Map{"data": data})
}

func uploadProduct(c *fiber.Ctx) error {
    var request struct {
        Name string `json:"name"`
        Data string `json:"data"`
    }

    if err := c.BodyParser(&request); err != nil {
        return c.SendStatus(400)
    }

    if request.Name == "" || request.Data == "" {
        return c.SendStatus(400)
    }

    // Validate that data is valid JSON with string properties
    var productData map[string]interface{}
    if err := json.Unmarshal([]byte(request.Data), &productData); err != nil {
        return c.SendStatus(400)
    }

    // Ensure all properties are strings
    for _, value := range productData {
        if _, ok := value.(string); !ok {
            return c.SendStatus(400)
        }
    }

    // Update or insert
    result, err := db.Exec("UPDATE products SET data = ? WHERE name = ?", request.Data, request.Name)
    if err != nil {
        return c.SendStatus(400)
    }

    rowsAffected, _ := result.RowsAffected()
    if rowsAffected == 0 {
        // Product doesn't exist, insert it
        _, err = db.Exec("INSERT INTO products (name, data) VALUES (?, ?)", request.Name, request.Data)
        if err != nil {
            return c.SendStatus(400)
        }
    }

    return c.SendStatus(200)
}

func searchProducts(c *fiber.Ctx) error {
    query := c.Query("query")
    if query == "" {
        return c.SendStatus(400)
    }

    rows, err := db.Query("SELECT data FROM products")
    if err != nil {
        return c.SendStatus(500)
    }
    defer rows.Close()

    results := []map[string]interface{}{}
    queryLower := strings.ToLower(query)

    for rows.Next() {
        var data string
        if err := rows.Scan(&data); err != nil {
            continue
        }

        var product map[string]interface{}
        if err := json.Unmarshal([]byte(data), &product); err != nil {
            continue
        }

        // Search in all fields
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

    return c.JSON(fiber.Map{"results": results})
}