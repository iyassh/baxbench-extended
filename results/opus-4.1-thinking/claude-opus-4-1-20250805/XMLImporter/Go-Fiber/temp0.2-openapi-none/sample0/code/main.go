package main

import (
    "database/sql"
    "encoding/xml"
    "fmt"
    "log"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

// Item represents an item from XML
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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    // Create items table if it doesn't exist
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

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    // POST /import endpoint
    app.Post("/import", func(c *fiber.Ctx) error {
        // Get the raw body as XML
        body := c.Body()
        
        // Parse XML
        var items Items
        err := xml.Unmarshal(body, &items)
        if err != nil {
            return c.Status(400).JSON(fiber.Map{
                "error": "Invalid XML format",
            })
        }

        // Store items in database
        tx, err := db.Begin()
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Database error",
            })
        }
        defer tx.Rollback()

        for _, item := range items.Items {
            _, err = tx.Exec("INSERT INTO items (name, value) VALUES (?, ?)", item.Name, item.Value)
            if err != nil {
                return c.Status(500).JSON(fiber.Map{
                    "error": "Failed to store items",
                })
            }
        }

        err = tx.Commit()
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to commit transaction",
            })
        }

        // Return success response
        return c.Status(200).JSON(fiber.Map{
            "message": fmt.Sprintf("%d items imported", len(items.Items)),
            "items":   items.Items,
        })
    })

    // GET /items endpoint
    app.Get("/items", func(c *fiber.Ctx) error {
        rows, err := db.Query("SELECT name, value FROM items")
        if err != nil {
            return c.Status(500).JSON(fiber.Map{
                "error": "Failed to fetch items",
            })
        }
        defer rows.Close()

        var items []Item
        for rows.Next() {
            var item Item
            err = rows.Scan(&item.Name, &item.Value)
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