package main

import (
    "database/sql"
    "encoding/xml"
    "fmt"
    "log"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

// XML structures for parsing
type Items struct {
    XMLName xml.Name `xml:"items"`
    Items   []Item   `xml:"item"`
}

type Item struct {
    Name  string `xml:"name" json:"name"`
    Value string `xml:"value" json:"value"`
}

// JSON response structures
type ImportResponse struct {
    Message string `json:"message"`
    Items   []Item `json:"items"`
}

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
    
    // Create table if not exists
    createTableQuery := `
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTableQuery)
    return err
}

func main() {
    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()
    
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit for security
    })
    
    // POST /import endpoint
    app.Post("/import", func(c *fiber.Ctx) error {
        // Get the raw body
        body := c.Body()
        
        // Check if body is empty
        if len(body) == 0 {
            return c.Status(400).JSON(ErrorResponse{
                Error: "Invalid XML format",
            })
        }
        
        // Parse XML
        var items Items
        err := xml.Unmarshal(body, &items)
        if err != nil {
            return c.Status(400).JSON(ErrorResponse{
                Error: "Invalid XML format",
            })
        }
        
        // Store items in database using transaction
        tx, err := db.Begin()
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{
                Error: "Database error",
            })
        }
        defer tx.Rollback() // Will be no-op if tx.Commit() succeeds
        
        for _, item := range items.Items {
            _, err = tx.Exec("INSERT INTO items (name, value) VALUES (?, ?)", item.Name, item.Value)
            if err != nil {
                return c.Status(500).JSON(ErrorResponse{
                    Error: "Failed to store items",
                })
            }
        }
        
        if err = tx.Commit(); err != nil {
            return c.Status(500).JSON(ErrorResponse{
                Error: "Failed to commit transaction",
            })
        }
        
        // Return success response
        message := fmt.Sprintf("%d items imported", len(items.Items))
        return c.JSON(ImportResponse{
            Message: message,
            Items:   items.Items,
        })
    })
    
    // GET /items endpoint
    app.Get("/items", func(c *fiber.Ctx) error {
        rows, err := db.Query("SELECT name, value FROM items")
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{
                Error: "Failed to retrieve items",
            })
        }
        defer rows.Close()
        
        items := make([]Item, 0)
        for rows.Next() {
            var item Item
            if err := rows.Scan(&item.Name, &item.Value); err != nil {
                return c.Status(500).JSON(ErrorResponse{
                    Error: "Failed to scan items",
                })
            }
            items = append(items, item)
        }
        
        // Check for errors from iterating over rows
        if err = rows.Err(); err != nil {
            return c.Status(500).JSON(ErrorResponse{
                Error: "Failed to read items",
            })
        }
        
        return c.JSON(items)
    })
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}