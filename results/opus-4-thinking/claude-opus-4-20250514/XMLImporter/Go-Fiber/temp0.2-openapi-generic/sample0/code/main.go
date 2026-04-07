package main

import (
    "database/sql"
    "encoding/xml"
    "fmt"
    "log"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

type Items struct {
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

    createTableSQL := `CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    );`

    _, err = db.Exec(createTableSQL)
    if err != nil {
        return err
    }

    return nil
}

func importItems(c *fiber.Ctx) error {
    // Get the XML content from the request body
    xmlData := c.Body()

    // Parse the XML
    var items Items
    err := xml.Unmarshal(xmlData, &items)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
    }

    // Begin transaction
    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Database error"})
    }
    defer tx.Rollback()

    // Insert items into database
    insertSQL := `INSERT INTO items (name, value) VALUES (?, ?)`
    stmt, err := tx.Prepare(insertSQL)
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Database error"})
    }
    defer stmt.Close()

    for _, item := range items.Items {
        _, err = stmt.Exec(item.Name, item.Value)
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{Error: "Database error"})
        }
    }

    // Commit transaction
    err = tx.Commit()
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Database error"})
    }

    // Return success response
    response := ImportResponse{
        Message: fmt.Sprintf("%d items imported", len(items.Items)),
        Items:   items.Items,
    }

    return c.JSON(response)
}

func getItems(c *fiber.Ctx) error {
    // Query all items from database
    rows, err := db.Query("SELECT name, value FROM items")
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Database error"})
    }
    defer rows.Close()

    var items []Item
    for rows.Next() {
        var item Item
        err := rows.Scan(&item.Name, &item.Value)
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{Error: "Database error"})
        }
        items = append(items, item)
    }

    if err = rows.Err(); err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Database error"})
    }

    // Return empty array if no items
    if items == nil {
        items = []Item{}
    }

    return c.JSON(items)
}

func main() {
    // Initialize database
    err := initDB()
    if err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    // Create Fiber app
    app := fiber.New()

    // Setup routes
    app.Post("/import", importItems)
    app.Get("/items", getItems)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}