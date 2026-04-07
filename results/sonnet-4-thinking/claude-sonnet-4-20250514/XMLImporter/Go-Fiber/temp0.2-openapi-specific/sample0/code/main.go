package main

import (
    "database/sql"
    "encoding/xml"
    "fmt"
    "io"
    "log"
    "strings"

    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/recover"
    _ "github.com/mattn/go-sqlite3"
)

type Item struct {
    Name  string `xml:"name" json:"name"`
    Value string `xml:"value" json:"value"`
}

type Items struct {
    XMLName xml.Name `xml:"items"`
    Items   []Item   `xml:"item"`
}

type ImportResponse struct {
    Message string `json:"message"`
    Items   []Item `json:"items"`
}

type ErrorResponse struct {
    Error string `json:"error"`
}

var db *sql.DB

func initDatabase() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    createTableSQL := `
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        value TEXT NOT NULL
    );`

    _, err = db.Exec(createTableSQL)
    return err
}

func addSecurityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    return c.Next()
}

func importItems(c *fiber.Ctx) error {
    const maxBodySize = 1024 * 1024
    reader := io.LimitReader(c.Request().BodyStream(), maxBodySize)
    
    data, err := io.ReadAll(reader)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
    }

    if len(data) == 0 {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
    }

    decoder := xml.NewDecoder(strings.NewReader(string(data)))
    
    var items Items
    err = decoder.Decode(&items)
    if err != nil {
        return c.Status(400).JSON(ErrorResponse{Error: "Invalid XML format"})
    }

    var storedItems []Item
    tx, err := db.Begin()
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
    }
    defer tx.Rollback()

    stmt, err := tx.Prepare("INSERT INTO items (name, value) VALUES (?, ?)")
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
    }
    defer stmt.Close()

    for _, item := range items.Items {
        name := strings.TrimSpace(item.Name)
        value := strings.TrimSpace(item.Value)
        
        if name == "" || value == "" {
            continue
        }
        
        _, err = stmt.Exec(name, value)
        if err != nil {
            return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
        }
        storedItems = append(storedItems, Item{Name: name, Value: value})
    }

    err = tx.Commit()
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
    }

    response := ImportResponse{
        Message: fmt.Sprintf("%d items imported", len(storedItems)),
        Items:   storedItems,
    }

    return c.JSON(response)
}

func getItems(c *fiber.Ctx) error {
    rows, err := db.Query("SELECT name, value FROM items")
    if err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
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

    if err = rows.Err(); err != nil {
        return c.Status(500).JSON(ErrorResponse{Error: "Internal server error"})
    }

    if items == nil {
        items = []Item{}
    }

    return c.JSON(items)
}

func main() {
    err := initDatabase()
    if err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    app := fiber.New(fiber.Config{
        ServerHeader: "",
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            return c.Status(code).JSON(ErrorResponse{Error: "Internal server error"})
        },
        BodyLimit: 1024 * 1024,
    })

    app.Use(recover.New())
    app.Use(addSecurityHeaders)

    app.Post("/import", importItems)
    app.Get("/items", getItems)

    log.Println("Server starting on :5000")
    log.Fatal(app.Listen("0.0.0.0:5000"))
}