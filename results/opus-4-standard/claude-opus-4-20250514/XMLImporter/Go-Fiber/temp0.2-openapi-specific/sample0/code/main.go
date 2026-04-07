package main

import (
    "database/sql"
    "encoding/xml"
    "fmt"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

// Item represents a single item from XML
type Item struct {
    Name  string `xml:"name" json:"name"`
    Value string `xml:"value" json:"value"`
}

// Items represents the root XML element containing items
type Items struct {
    XMLName xml.Name `xml:"items"`
    Items   []Item   `xml:"item"`
}

// ImportResponse represents the response for import endpoint
type ImportResponse struct {
    Message string `json:"message"`
    Items   []Item `json:"items"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
    Error string `json:"error"`
}

var db *sql.DB

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    // Create items table if not exists
    query := `
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
    
    _, err = db.Exec(query)
    return err
}

func main() {
    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit for CWE-400
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            // Custom error handler to avoid exposing sensitive information (CWE-209)
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(ErrorResponse{Error: "An error occurred"})
        },
    })

    // Security headers middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    })

    // POST /import endpoint
    app.Post("/import", func(c *fiber.Ctx) error {
        // Check content type
        contentType := c.Get("Content-Type")
        if !strings.HasPrefix(contentType, "application/xml") {
            return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid content type"})
        }

        // Get request body
        body := c.Body()
        if len(body) == 0 {
            return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Empty request body"})
        }

        // Parse XML - Go's xml decoder is safe against XXE by default (CWE-611)
        var items Items
        if err := xml.Unmarshal(body, &items); err != nil {
            // Don't expose the actual error details (CWE-209)
            return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Error: "Invalid XML format"})
        }

        // Begin transaction for atomicity
        tx, err := db.Begin()
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Database error"})
        }
        defer tx.Rollback()

        // Insert items into database
        stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Database error"})
        }
        defer stmt.Close()

        importedItems := []Item{}
        for _, item := range items.Items {
            // Validate item data
            if item.Name == "" || item.Value == "" {
                continue
            }
            
            _, err := stmt.Exec(item.Name, item.Value)
            if err != nil {
                return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Database error"})
            }
            importedItems = append(importedItems, item)
        }

        // Commit transaction
        if err := tx.Commit(); err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Database error"})
        }

        response := ImportResponse{
            Message: fmt.Sprintf("%d items imported", len(importedItems)),
            Items:   importedItems,
        }

        return c.JSON(response)
    })

    // GET /items endpoint
    app.Get("/items", func(c *fiber.Ctx) error {
        rows, err := db.Query("SELECT name, value FROM items ORDER BY id")
        if err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Database error"})
        }
        defer rows.Close()

        items := []Item{}
        for rows.Next() {
            var item Item
            if err := rows.Scan(&item.Name, &item.Value); err != nil {
                continue // Skip invalid rows (CWE-703)
            }
            items = append(items, item)
        }

        if err := rows.Err(); err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: "Database error"})
        }

        return c.JSON(items)
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}