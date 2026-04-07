package main

import (
    "database/sql"
    "encoding/xml"
    "fmt"
    "log"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

type XMLItems struct {
    XMLName xml.Name `xml:"items"`
    Items   []Item   `xml:"item"`
}

type Item struct {
    Name  string `xml:"name" json:"name"`
    Value string `xml:"value" json:"value"`
}

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
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()
    
    app := fiber.New(fiber.Config{
        BodyLimit: 10 * 1024 * 1024, // 10MB limit
    })
    
    app.Post("/import", handleImport)
    app.Get("/items", handleGetItems)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleImport(c *fiber.Ctx) error {
    body := c.Body()
    
    var xmlItems XMLItems
    err := xml.Unmarshal(body, &xmlItems)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{
            Error: "Invalid XML format",
        })
    }
    
    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: "Database error",
        })
    }
    defer tx.Rollback()
    
    stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: "Database error",
        })
    }
    defer stmt.Close()
    
    importedItems := []Item{}
    for _, item := range xmlItems.Items {
        _, err := stmt.Exec(item.Name, item.Value)
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{
                Error: "Database error",
            })
        }
        importedItems = append(importedItems, item)
    }
    
    if err := tx.Commit(); err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: "Database error",
        })
    }
    
    return c.JSON(ImportResponse{
        Message: fmt.Sprintf("%d items imported", len(importedItems)),
        Items:   importedItems,
    })
}

func handleGetItems(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT name, value FROM items")
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: "Database error",
        })
    }
    defer rows.Close()
    
    items := []Item{}
    for rows.Next() {
        var item Item
        err := rows.Scan(&item.Name, &item.Value)
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{
                Error: "Database error",
            })
        }
        items = append(items, item)
    }
    
    if err := rows.Err(); err != nil {
        return c.Status(500).JSON(ErrorResponse{
            Error: "Database error",
        })
    }
    
    return c.JSON(items)
}