package main

import (
    "database/sql"
    "fmt"
    "html"
    "log"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

type Product struct {
    ID          int      `json:"id"`
    ProductName string   `json:"product_name"`
    Tags        []string `json:"tags"`
}

type PostProductRequest struct {
    ProductName string   `json:"product_name"`
    Tags        []string `json:"tags"`
}

var db *sql.DB

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }
    
    // Create tables
    createProductsTable := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL
    );`
    
    createTagsTable := `
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT UNIQUE NOT NULL
    );`
    
    createProductTagsTable := `
    CREATE TABLE IF NOT EXISTS product_tags (
        product_id INTEGER,
        tag_id INTEGER,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id),
        PRIMARY KEY (product_id, tag_id)
    );`
    
    if _, err = db.Exec(createProductsTable); err != nil {
        return err
    }
    if _, err = db.Exec(createTagsTable); err != nil {
        return err
    }
    if _, err = db.Exec(createProductTagsTable); err != nil {
        return err
    }
    
    return nil
}

func getRecommendations(c *fiber.Ctx) error {
    tagsParam := c.Query("tags")
    if tagsParam == "" {
        return c.Status(400).SendString("tags parameter is required")
    }
    
    // Split tags by comma and trim whitespace
    tagsList := strings.Split(tagsParam, ",")
    for i := range tagsList {
        tagsList[i] = strings.TrimSpace(tagsList[i])
    }
    
    // Build query with placeholders
    placeholders := make([]string, len(tagsList))
    args := make([]interface{}, len(tagsList))
    for i, tag := range tagsList {
        placeholders[i] = "?"
        args[i] = tag
    }
    
    query := fmt.Sprintf(`
        SELECT DISTINCT p.id, p.product_name
        FROM products p
        JOIN product_tags pt ON p.id = pt.product_id
        JOIN tags t ON pt.tag_id = t.id
        WHERE t.tag_name IN (%s)
    `, strings.Join(placeholders, ","))
    
    rows, err := db.Query(query, args...)
    if err != nil {
        return c.Status(500).SendString("Database error")
    }
    defer rows.Close()
    
    var products []Product
    for rows.Next() {
        var product Product
        if err := rows.Scan(&product.ID, &product.ProductName); err != nil {
            continue
        }
        
        // Get tags for this product
        tagQuery := `
            SELECT t.tag_name
            FROM tags t
            JOIN product_tags pt ON t.id = pt.tag_id
            WHERE pt.product_id = ?
        `
        tagRows, err := db.Query(tagQuery, product.ID)
        if err == nil {
            for tagRows.Next() {
                var tag string
                if err := tagRows.Scan(&tag); err == nil {
                    product.Tags = append(product.Tags, tag)
                }
            }
            tagRows.Close()
        }
        
        products = append(products, product)
    }
    
    // Generate HTML response with proper escaping
    escapedTags := make([]string, len(tagsList))
    for i, tag := range tagsList {
        escapedTags[i] = html.EscapeString(tag)
    }
    
    htmlContent := `<!DOCTYPE html>
<html>
<head>
    <title>Product Recommendations</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; border-radius: 5px; }
        .product-name { font-weight: bold; font-size: 18px; }
        .tags { margin-top: 5px; }
        .tag { display: inline-block; background: #e0e0e0; padding: 3px 8px; margin: 2px; border-radius: 3px; font-size: 14px; }
        .no-results { color: #666; font-style: italic; }
    </style>
</head>
<body>
    <h1>Product Recommendations</h1>
    <p>Searched tags: ` + strings.Join(escapedTags, ", ") + `</p>`
    
    if len(products) == 0 {
        htmlContent += `<p class="no-results">No products found for the given tags.</p>`
    } else {
        htmlContent += `<div class="products">`
        for _, product := range products {
            htmlContent += fmt.Sprintf(`
        <div class="product">
            <div class="product-name">%s</div>
            <div class="tags">`, html.EscapeString(product.ProductName))
            
            for _, tag := range product.Tags {
                htmlContent += fmt.Sprintf(`<span class="tag">%s</span>`, html.EscapeString(tag))
            }
            
            htmlContent += `</div>
        </div>`
        }
        htmlContent += `</div>`
    }
    
    htmlContent += `
</body>
</html>`
    
    c.Set("Content-Type", "text/html")
    return c.SendString(htmlContent)
}

func postProduct(c *fiber.Ctx) error {
    var req PostProductRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }
    
    if req.ProductName == "" || len(req.Tags) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
    }
    
    // Start transaction
    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    
    // Insert product
    result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
    if err != nil {
        tx.Rollback()
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    
    productID, err := result.LastInsertId()
    if err != nil {
        tx.Rollback()
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    
    // Insert tags and create relationships
    for _, tagName := range req.Tags {
        tagName = strings.TrimSpace(tagName)
        if tagName == "" {
            continue
        }
        
        // Insert or get tag ID
        var tagID int64
        err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tagName).Scan(&tagID)
        if err == sql.ErrNoRows {
            // Tag doesn't exist, insert it
            result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tagName)
            if err != nil {
                tx.Rollback()
                return c.Status(500).JSON(fiber.Map{"error": "Database error"})
            }
            tagID, err = result.LastInsertId()
            if err != nil {
                tx.Rollback()
                return c.Status(500).JSON(fiber.Map{"error": "Database error"})
            }
        } else if err != nil {
            tx.Rollback()
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
        
        // Create product-tag relationship
        _, err = tx.Exec("INSERT INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
        if err != nil {
            tx.Rollback()
            return c.Status(500).JSON(fiber.Map{"error": "Database error"})
        }
    }
    
    if err := tx.Commit(); err != nil {
        return c.Status(500).JSON(fiber.Map{"error": "Database error"})
    }
    
    return c.SendStatus(200)
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()
    
    app := fiber.New()
    
    app.Get("/recommender", getRecommendations)
    app.Post("/recommender", postProduct)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}