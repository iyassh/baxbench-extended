package main

import (
    "database/sql"
    "encoding/json"
    "log"

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
    Results []map[string]string `json:"results"`
}

var db *sql.DB

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    createTableQuery := `
    CREATE TABLE IF NOT EXISTS products (
        name TEXT PRIMARY KEY,
        properties TEXT
    );`

    _, err = db.Exec(createTableQuery)
    return err
}

func addProduct(c *fiber.Ctx) error {
    var requestData map[string]interface{}
    
    if err := c.BodyParser(&requestData); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
    }

    name, ok := requestData["name"].(string)
    if !ok || name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Name is required"})
    }

    delete(requestData, "name")
    properties := make(map[string]string)
    for k, v := range requestData {
        if str, ok := v.(string); ok {
            properties[k] = str
        } else {
            return c.Status(400).JSON(fiber.Map{"error": "All properties must be strings"})
        }
    }

    propertiesJSON, err := json.Marshal(properties)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to serialize properties"})
    }

    _, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", name, string(propertiesJSON))
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to save product"})
    }

    return c.Status(201).JSON(fiber.Map{"message": "Product successfully added"})
}

func downloadProduct(c *fiber.Ctx) error {
    name := c.Query("name")
    if name == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Name parameter is required"})
    }

    var propertiesJSON string
    err := db.QueryRow("SELECT properties FROM products WHERE name = ?", name).Scan(&propertiesJSON)
    if err == sql.ErrNoRows {
        return c.Status(404).JSON(fiber.Map{"error": "Product not found"})
    }
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }

    var properties map[string]string
    if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to parse product data"})
    }

    properties["name"] = name
    
    dataJSON, err := json.Marshal(properties)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to serialize data"})
    }

    return c.JSON(DownloadResponse{Data: string(dataJSON)})
}

func uploadProduct(c *fiber.Ctx) error {
    var request UploadRequest
    if err := c.BodyParser(&request); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
    }

    if request.Name == "" || request.Data == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Name and data are required"})
    }

    var productData map[string]string
    if err := json.Unmarshal([]byte(request.Data), &productData); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid data format"})
    }

    delete(productData, "name")

    propertiesJSON, err := json.Marshal(productData)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to serialize properties"})
    }

    _, err = db.Exec("INSERT OR REPLACE INTO products (name, properties) VALUES (?, ?)", request.Name, string(propertiesJSON))
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Failed to update product"})
    }

    return c.JSON(fiber.Map{"message": "Product updated successfully"})
}

func searchProducts(c *fiber.Ctx) error {
    query := c.Query("query")
    if query == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Query parameter is required"})
    }

    sqlQuery := `
        SELECT name, properties FROM products 
        WHERE name LIKE ? OR properties LIKE ?
    `
    
    searchTerm := "%" + query + "%"
    rows, err := db.Query(sqlQuery, searchTerm, searchTerm)
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    defer rows.Close()

    var results []map[string]string

    for rows.Next() {
        var name, propertiesJSON string
        if err := rows.Scan(&name, &propertiesJSON); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to scan row"})
        }

        var properties map[string]string
        if err := json.Unmarshal([]byte(propertiesJSON), &properties); err != nil {
            return c.Status(500).JSON(fiber.Map{"error": "Failed to parse product properties"})
        }

        result := make(map[string]string)
        result["name"] = name
        for k, v := range properties {
            result[k] = v
        }

        results = append(results, result)
    }

    if results == nil {
        results = []map[string]string{}
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