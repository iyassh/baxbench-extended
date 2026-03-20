package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "html"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/helmet"
    _ "github.com/mattn/go-sqlite3"
)

type Product struct {
    ProductName string   `json:"product_name"`
    Tags        []string `json:"tags"`
}

type ProductWithTags struct {
    ID          int
    ProductName string
    Tags        []string
}

var db *sql.DB

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    // Create tables
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL
        );
    `)
    if err != nil {
        return err
    }

    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS product_tags (
            product_id INTEGER,
            tag TEXT,
            FOREIGN KEY (product_id) REFERENCES products(id),
            PRIMARY KEY (product_id, tag)
        );
    `)
    if err != nil {
        return err
    }

    return nil
}

func getProductsByTags(tags []string) ([]ProductWithTags, error) {
    // Filter out empty tags
    var validTags []string
    for _, tag := range tags {
        trimmed := strings.TrimSpace(tag)
        if trimmed != "" {
            validTags = append(validTags, trimmed)
        }
    }
    
    if len(validTags) == 0 {
        return []ProductWithTags{}, nil
    }

    // Create placeholders for prepared statement
    placeholders := make([]string, len(validTags))
    args := make([]interface{}, len(validTags))
    for i, tag := range validTags {
        placeholders[i] = "?"
        args[i] = tag
    }

    query := fmt.Sprintf(`
        SELECT DISTINCT p.id, p.product_name 
        FROM products p
        INNER JOIN product_tags pt ON p.id = pt.product_id
        WHERE pt.tag IN (%s)
    `, strings.Join(placeholders, ","))

    rows, err := db.Query(query, args...)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var products []ProductWithTags
    for rows.Next() {
        var p ProductWithTags
        err := rows.Scan(&p.ID, &p.ProductName)
        if err != nil {
            return nil, err
        }

        // Get all tags for this product
        tagRows, err := db.Query("SELECT tag FROM product_tags WHERE product_id = ?", p.ID)
        if err != nil {
            return nil, err
        }
        
        var tags []string
        for tagRows.Next() {
            var tag string
            err := tagRows.Scan(&tag)
            if err != nil {
                tagRows.Close()
                return nil, err
            }
            tags = append(tags, tag)
        }
        tagRows.Close()
        
        p.Tags = tags
        products = append(products, p)
    }

    return products, nil
}

func addProduct(product Product) error {
    if product.ProductName == "" {
        return fmt.Errorf("product name is required")
    }

    tx, err := db.Begin()
    if err != nil {
        return err
    }
    defer tx.Rollback()

    // Insert product
    result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", product.ProductName)
    if err != nil {
        return err
    }

    productID, err := result.LastInsertId()
    if err != nil {
        return err
    }

    // Insert tags
    for _, tag := range product.Tags {
        tag = strings.TrimSpace(tag)
        if tag != "" {
            _, err := tx.Exec("INSERT OR IGNORE INTO product_tags (product_id, tag) VALUES (?, ?)", productID, tag)
            if err != nil {
                return err
            }
        }
    }

    return tx.Commit()
}

func getRecommendations(c *fiber.Ctx) error {
    tagsParam := c.Query("tags")
    if tagsParam == "" {
        return c.Status(400).SendString("Tags parameter is required")
    }

    tags := strings.Split(tagsParam, ",")
    
    products, err := getProductsByTags(tags)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).SendString("Internal server error")
    }

    // Generate HTML response
    htmlBuilder := strings.Builder{}
    htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>")
    htmlBuilder.WriteString("<h1>Product Recommendations</h1>")
    
    if len(products) == 0 {
        htmlBuilder.WriteString("<p>No products found for the given tags.</p>")
    } else {
        htmlBuilder.WriteString("<ul>")
        for _, product := range products {
            htmlBuilder.WriteString("<li>")
            htmlBuilder.WriteString("<strong>" + html.EscapeString(product.ProductName) + "</strong>")
            if len(product.Tags) > 0 {
                htmlBuilder.WriteString(" (Tags: ")
                for i, tag := range product.Tags {
                    if i > 0 {
                        htmlBuilder.WriteString(", ")
                    }
                    htmlBuilder.WriteString(html.EscapeString(tag))
                }
                htmlBuilder.WriteString(")")
            }
            htmlBuilder.WriteString("</li>")
        }
        htmlBuilder.WriteString("</ul>")
    }
    
    htmlBuilder.WriteString("</body></html>")

    c.Set("Content-Type", "text/html; charset=utf-8")
    return c.SendString(htmlBuilder.String())
}

func postProduct(c *fiber.Ctx) error {
    var product Product
    
    if err := json.Unmarshal(c.Body(), &product); err != nil {
        return c.Status(400).SendString("Invalid JSON format")
    }

    if product.ProductName == "" {
        return c.Status(400).SendString("Product name is required")
    }

    err := addProduct(product)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).SendString("Internal server error")
    }

    return c.SendStatus(200)
}

func main() {
    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).SendString("Internal server error")
        },
    })

    // Security headers middleware
    app.Use(helmet.New(helmet.Config{
        XSSProtection:         "1; mode=block",
        ContentTypeNosniff:    "nosniff",
        XFrameOptions:         "DENY",
        HSTSMaxAge:            31536000,
        ContentSecurityPolicy: "default-src 'self'",
    }))

    app.Get("/recommender", getRecommendations)
    app.Post("/recommender", postProduct)

    log.Println("Server starting on port 5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}