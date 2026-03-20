package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "html"
    "log"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type ProductRequest struct {
    ProductName string   `json:"product_name"`
    Tags        []string `json:"tags"`
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    // Create tables
    createTables := `
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT NOT NULL UNIQUE
    );
    
    CREATE TABLE IF NOT EXISTS product_tags (
        product_id INTEGER,
        tag_id INTEGER,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id),
        PRIMARY KEY (product_id, tag_id)
    );
    `
    
    _, err = db.Exec(createTables)
    return err
}

func main() {
    if err := initDB(); err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            ctx.Set(fiber.HeaderContentType, fiber.MIMETextPlain)
            return ctx.Status(code).SendString("An error occurred")
        },
    })

    // Security headers middleware
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    })

    app.Get("/recommender", getRecommendations)
    app.Post("/recommender", postProduct)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func getRecommendations(c *fiber.Ctx) error {
    tagsParam := c.Query("tags")
    if tagsParam == "" {
        return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
    }

    tags := strings.Split(tagsParam, ",")
    for i := range tags {
        tags[i] = strings.TrimSpace(tags[i])
    }

    // Build query with placeholders
    placeholders := make([]string, len(tags))
    args := make([]interface{}, len(tags))
    for i, tag := range tags {
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
        log.Printf("Database query error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }
    defer rows.Close()

    var htmlContent strings.Builder
    htmlContent.WriteString("<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>")
    htmlContent.WriteString("<h1>Product Recommendations</h1><ul>")

    hasResults := false
    for rows.Next() {
        var id int
        var productName string
        if err := rows.Scan(&id, &productName); err != nil {
            log.Printf("Row scan error: %v", err)
            continue
        }
        hasResults = true
        escapedName := html.EscapeString(productName)
        htmlContent.WriteString(fmt.Sprintf("<li><a href=\"#\">%s</a></li>", escapedName))
    }

    if !hasResults {
        htmlContent.WriteString("<li>No products found for the given tags.</li>")
    }

    htmlContent.WriteString("</ul></body></html>")

    c.Set(fiber.HeaderContentType, fiber.MIMETextHTML)
    return c.SendString(htmlContent.String())
}

func postProduct(c *fiber.Ctx) error {
    var req ProductRequest
    if err := json.Unmarshal(c.Body(), &req); err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }

    if req.ProductName == "" || len(req.Tags) == 0 {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
    }

    tx, err := db.Begin()
    if err != nil {
        log.Printf("Transaction begin error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }
    defer tx.Rollback()

    // Insert product
    result, err := tx.Exec("INSERT INTO products (product_name) VALUES (?)", req.ProductName)
    if err != nil {
        log.Printf("Product insert error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }

    productID, err := result.LastInsertId()
    if err != nil {
        log.Printf("LastInsertId error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }

    // Insert tags and create associations
    for _, tag := range req.Tags {
        tag = strings.TrimSpace(tag)
        if tag == "" {
            continue
        }

        // Insert or get existing tag
        var tagID int64
        err := tx.QueryRow("SELECT id FROM tags WHERE tag_name = ?", tag).Scan(&tagID)
        if err == sql.ErrNoRows {
            result, err := tx.Exec("INSERT INTO tags (tag_name) VALUES (?)", tag)
            if err != nil {
                log.Printf("Tag insert error: %v", err)
                return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
            }
            tagID, err = result.LastInsertId()
            if err != nil {
                log.Printf("Tag LastInsertId error: %v", err)
                return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
            }
        } else if err != nil {
            log.Printf("Tag select error: %v", err)
            return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
        }

        // Create product-tag association
        _, err = tx.Exec("INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)", productID, tagID)
        if err != nil {
            log.Printf("Product-tag insert error: %v", err)
            return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
        }
    }

    if err := tx.Commit(); err != nil {
        log.Printf("Transaction commit error: %v", err)
        return c.Status(fiber.StatusInternalServerError).SendString("An error occurred")
    }

    return c.SendStatus(fiber.StatusOK)
}