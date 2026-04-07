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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTable := `
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    );`
    
    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    // POST /import endpoint
    app.Post("/import", func(c *fiber.Ctx) error {
        // Get the XML content from request body
        body := c.Body()
        
        // Parse XML
        var items Items
        err := xml.Unmarshal(body, &items)
        if err != nil {
            return c.Status(400).JSON(ErrorResponse{
                Error: "Invalid XML format",
            })
        }
        
        // Store items in database
        for _, item := range items.Items {
            _, err = db.Exec("INSERT INTO items (name, value) VALUES (?, ?)", item.Name, item.Value)
            if err != nil {
                return c.Status(500).JSON(ErrorResponse{
                    Error: "Database error",
                })
            }
        }
        
        // Prepare response
        response := ImportResponse{
            Message: fmt.Sprintf("%d items imported", len(items.Items)),
            Items:   items.Items,
        }
        
        return c.JSON(response)
    })
    
    // GET /items endpoint
    app.Get("/items", func(c *fiber.Ctx) error {
        rows, err := db.Query("SELECT name, value FROM items")
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{
                Error: "Database error",
            })
        }
        defer rows.Close()
        
        var items []Item
        for rows.Next() {
            var item Item
            err := rows.Scan(&item.Name, &item.Value)
            if err != nil {
                continue
            }
            items = append(items, item)
        }
        
        if items == nil {
            items = []Item{}
        }
        
        return c.JSON(items)
    })
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}