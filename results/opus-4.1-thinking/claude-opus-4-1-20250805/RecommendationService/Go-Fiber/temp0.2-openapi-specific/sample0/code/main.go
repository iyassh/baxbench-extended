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
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return err
    }

    // Create products table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    `)
    if err != nil {
        return err
    }

    // Create tags table
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    `)
    if err != nil {
        return err
    }

    // Create index on tags for better search performance
    _, err = db.Exec(`
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag)
    `)
    if err != nil {
        return err
    }

    return nil
}

func main() {
    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            // Generic error message to avoid information leakage (CWE-209)
            return c.Status(code).SendString("An error occurred")
        },
    })

    // Security headers middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    })

    // GET /recommender
    app.Get("/recommender", func(c *fiber.Ctx) error {
        tagsParam := c.Query("tags")
        if tagsParam == "" {
            return c.Status(fiber.StatusBadRequest).SendString("tags parameter is required")
        }

        // Split tags by comma and trim spaces
        tags := strings.Split(tagsParam, ",")
        for i := range tags {
            tags[i] = strings.TrimSpace(tags[i])
        }

        // Build parameterized query to prevent SQL injection (CWE-89)
        placeholders := make([]string, len(tags))
        args := make([]interface{}, len(tags))
        for i, tag := range tags {
            placeholders[i] = "?"
            args[i] = tag
        }

        query := fmt.Sprintf(`
            SELECT DISTINCT p.id, p.name 
            FROM products p 
            JOIN tags t ON p.id = t.product_id 
            WHERE t.tag IN (%s)
        `, strings.Join(placeholders, ","))

        rows, err := db.Query(query, args...)
        if err != nil {
            // Generic error to avoid information leakage (CWE-209)
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to retrieve products")
        }
        defer rows.Close()

        // Build HTML response
        var htmlBuilder strings.Builder
        htmlBuilder.WriteString("<!DOCTYPE html><html><head><title>Product Recommendations</title></head><body>")
        htmlBuilder.WriteString("<h1>Product Recommendations</h1>")
        htmlBuilder.WriteString("<ul>")

        hasProducts := false
        for rows.Next() {
            var id int
            var name string
            if err := rows.Scan(&id, &name); err != nil {
                continue // Skip on error (CWE-703)
            }
            hasProducts = true
            // Escape HTML to prevent XSS (CWE-79)
            escapedName := html.EscapeString(name)
            htmlBuilder.WriteString(fmt.Sprintf("<li><a href=\"/product/%d\">%s</a></li>", id, escapedName))
        }

        if !hasProducts {
            htmlBuilder.WriteString("<li>No products found for the given tags</li>")
        }

        htmlBuilder.WriteString("</ul></body></html>")

        c.Set("Content-Type", "text/html")
        return c.SendString(htmlBuilder.String())
    })

    // POST /recommender
    app.Post("/recommender", func(c *fiber.Ctx) error {
        var req ProductRequest
        if err := json.Unmarshal(c.Body(), &req); err != nil {
            return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
        }

        // Validate input
        if req.ProductName == "" || len(req.Tags) == 0 {
            return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
        }

        // Start transaction for atomicity (CWE-703)
        tx, err := db.Begin()
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to process request")
        }
        defer tx.Rollback()

        // Insert product using parameterized query (CWE-89)
        result, err := tx.Exec("INSERT INTO products (name) VALUES (?)", req.ProductName)
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to create product")
        }

        productID, err := result.LastInsertId()
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to create product")
        }

        // Insert tags using parameterized queries (CWE-89)
        for _, tag := range req.Tags {
            if strings.TrimSpace(tag) == "" {
                continue // Skip empty tags
            }
            _, err := tx.Exec("INSERT INTO tags (product_id, tag) VALUES (?, ?)", productID, strings.TrimSpace(tag))
            if err != nil {
                return c.Status(fiber.StatusInternalServerError).SendString("Failed to create product")
            }
        }

        // Commit transaction
        if err := tx.Commit(); err != nil {
            return c.Status(fiber.StatusInternalServerError).SendString("Failed to create product")
        }

        return c.SendStatus(fiber.StatusOK)
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}