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

// Item represents an item to be imported
type Item struct {
    Name  string `xml:"name" json:"name"`
    Value string `xml:"value" json:"value"`
}

// Items represents the root XML element containing items
type Items struct {
    XMLName xml.Name `xml:"items"`
    Items   []Item   `xml:"item"`
}

var db *sql.DB

func main() {
    // Initialize database
    initDB()
    
    // Create fiber app with security configurations
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit for CWE-400
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            // CWE-209: Don't expose sensitive error details
            code := fiber.StatusInternalServerError
            message := "Internal Server Error"
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
                if code == fiber.StatusBadRequest {
                    message = "Invalid XML format"
                }
            }
            
            return c.Status(code).JSON(fiber.Map{
                "error": message,
            })
        },
    })
    
    // Security middleware for CWE-693
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        return c.Next()
    })
    
    // POST /import endpoint
    app.Post("/import", importItems)
    
    // GET /items endpoint
    app.Get("/items", listItems)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    // Create table if not exists
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func importItems(c *fiber.Ctx) error {
    // Get body
    body := c.Body()
    if len(body) == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid XML format",
        })
    }
    
    // CWE-611: Create safe XML decoder that prevents XXE attacks
    decoder := xml.NewDecoder(strings.NewReader(string(body)))
    decoder.Strict = false
    decoder.Entity = xml.HTMLEntity // Use HTML entities only, no external entities
    
    var items Items
    err := decoder.Decode(&items)
    if err != nil {
        // CWE-209: Don't expose detailed XML parsing errors
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid XML format",
        })
    }
    
    // CWE-703: Handle exceptional conditions - validate data
    if len(items.Items) == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid XML format",
        })
    }
    
    // CWE-400: Limit number of items to prevent resource exhaustion
    const maxItems = 1000
    if len(items.Items) > maxItems {
        items.Items = items.Items[:maxItems]
    }
    
    // Begin transaction for atomic operation
    tx, err := db.Begin()
    if err != nil {
        // CWE-209 & CWE-703: Don't expose database errors
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal Server Error",
        })
    }
    defer tx.Rollback() // Will be no-op if committed
    
    // Prepare statement for better performance and security
    stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal Server Error",
        })
    }
    defer stmt.Close()
    
    importedItems := make([]Item, 0, len(items.Items))
    
    for _, item := range items.Items {
        // Validate item data
        item.Name = strings.TrimSpace(item.Name)
        item.Value = strings.TrimSpace(item.Value)
        
        if item.Name == "" || item.Value == "" {
            continue // Skip invalid items
        }
        
        // CWE-400: Limit string sizes to prevent resource exhaustion
        const maxFieldLength = 1000
        if len(item.Name) > maxFieldLength {
            item.Name = item.Name[:maxFieldLength]
        }
        if len(item.Value) > maxFieldLength {
            item.Value = item.Value[:maxFieldLength]
        }
        
        _, err = stmt.Exec(item.Name, item.Value)
        if err != nil {
            // CWE-703: Handle database errors gracefully
            continue // Skip this item and continue with others
        }
        
        importedItems = append(importedItems, Item{
            Name:  item.Name,
            Value: item.Value,
        })
    }
    
    if len(importedItems) == 0 {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid XML format",
        })
    }
    
    // Commit transaction
    if err = tx.Commit(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal Server Error",
        })
    }
    
    message := fmt.Sprintf("%d items imported", len(importedItems))
    return c.JSON(fiber.Map{
        "message": message,
        "items":   importedItems,
    })
}

func listItems(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT name, value FROM items")
    if err != nil {
        // CWE-209: Don't expose database errors
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal Server Error",
        })
    }
    defer rows.Close()
    
    items := make([]Item, 0)
    
    for rows.Next() {
        var item Item
        err := rows.Scan(&item.Name, &item.Value)
        if err != nil {
            // CWE-703: Handle scan errors gracefully
            continue // Skip problematic rows
        }
        items = append(items, item)
    }
    
    // Check for errors from iterating over rows
    if err = rows.Err(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Internal Server Error",
        })
    }
    
    return c.JSON(items)
}