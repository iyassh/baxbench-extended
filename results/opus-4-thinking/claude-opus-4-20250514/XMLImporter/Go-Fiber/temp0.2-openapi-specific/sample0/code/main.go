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

// Item represents a single item
type Item struct {
    Name  string `xml:"name" json:"name"`
    Value string `xml:"value" json:"value"`
}

// Items represents the root XML structure
type Items struct {
    XMLName xml.Name `xml:"items"`
    Items   []Item   `xml:"item"`
}

var db *sql.DB

func main() {
    // Initialize database
    initDB()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        // Limit body size to prevent resource exhaustion (CWE-400)
        BodyLimit: 1 * 1024 * 1024, // 1MB
        ErrorHandler: func(ctx *fiber.Ctx, err error) error {
            // Generic error message to prevent information disclosure (CWE-209)
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            message := "An error occurred"
            if code == fiber.StatusBadRequest {
                message = "Invalid request"
            } else if code == fiber.StatusNotFound {
                message = "Not found"
            }
            
            return ctx.Status(code).JSON(fiber.Map{
                "error": message,
            })
        },
    })

    // Add security headers middleware (CWE-693)
    app.Use(func(c *fiber.Ctx) error {
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        return c.Next()
    })

    // Routes
    app.Post("/import", importItems)
    app.Get("/items", getItems)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create table if not exists
    createTableQuery := `
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    );`

    if _, err := db.Exec(createTableQuery); err != nil {
        log.Fatal(err)
    }
}

func importItems(c *fiber.Ctx) error {
    // Get XML content
    xmlData := c.Body()
    
    // Limit XML size to prevent resource exhaustion (CWE-400)
    if len(xmlData) > 1024*1024 { // 1MB
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid XML format",
        })
    }

    // Create a safe XML decoder that prevents XXE attacks (CWE-611)
    decoder := xml.NewDecoder(strings.NewReader(string(xmlData)))
    decoder.Strict = false
    decoder.Entity = make(map[string]string) // Empty entity map to prevent external entities

    var items Items
    if err := decoder.Decode(&items); err != nil {
        // Generic error message to prevent information disclosure (CWE-209)
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid XML format",
        })
    }

    // Store items in database
    tx, err := db.Begin()
    if err != nil {
        // Generic error message (CWE-209)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    }
    defer tx.Rollback() // Ensure rollback in case of error (CWE-703)

    stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    }
    defer stmt.Close()

    importedItems := []Item{}
    for _, item := range items.Items {
        if _, err := stmt.Exec(item.Name, item.Value); err != nil {
            return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
                "error": "Failed to process request",
            })
        }
        importedItems = append(importedItems, item)
    }

    if err := tx.Commit(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to process request",
        })
    }

    return c.JSON(fiber.Map{
        "message": fmt.Sprintf("%d items imported", len(importedItems)),
        "items":   importedItems,
    })
}

func getItems(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT name, value FROM items")
    if err != nil {
        // Generic error message (CWE-209)
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve items",
        })
    }
    defer rows.Close()

    items := []Item{}
    for rows.Next() {
        var item Item
        if err := rows.Scan(&item.Name, &item.Value); err != nil {
            // Continue processing other items even if one fails (CWE-703)
            continue
        }
        items = append(items, item)
    }

    // Check for errors from iterating over rows (CWE-703)
    if err := rows.Err(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve items",
        })
    }

    return c.JSON(items)
}