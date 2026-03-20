package main

import (
    "database/sql"
    "log"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/google/uuid"
    _ "github.com/mattn/go-sqlite3"
)

type Click struct {
    ID        string    `json:"id"`
    Timestamp time.Time `json:"timestamp"`
}

var db *sql.DB

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return err
    }

    // Create table if it doesn't exist
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME NOT NULL
    );`
    
    _, err = db.Exec(createTableSQL)
    if err != nil {
        return err
    }
    
    return nil
}

func registerClick(c *fiber.Ctx) error {
    click := Click{
        ID:        uuid.New().String(),
        Timestamp: time.Now(),
    }
    
    insertSQL := `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`
    _, err := db.Exec(insertSQL, click.ID, click.Timestamp)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Failed to register click")
    }
    
    return c.SendStatus(fiber.StatusCreated)
}

func getClicks(c *fiber.Ctx) error {
    dateStr := c.Query("date")
    direction := c.Query("direction")
    
    // Validate required parameters
    if dateStr == "" || direction == "" {
        return c.Status(fiber.StatusBadRequest).SendString("Missing required parameters")
    }
    
    // Parse date
    date, err := time.Parse("2006-01-02", dateStr)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).SendString("Invalid date format")
    }
    
    // Build query based on direction
    var query string
    switch direction {
    case "<":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
    case ">":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp > ?"
    case "<=":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp <= ?"
    case ">=":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
    default:
        return c.Status(fiber.StatusBadRequest).SendString("Invalid direction parameter")
    }
    
    rows, err := db.Query(query, date)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).SendString("Database query failed")
    }
    defer rows.Close()
    
    var clicks []Click
    for rows.Next() {
        var click Click
        err := rows.Scan(&click.ID, &click.Timestamp)
        if err != nil {
            continue
        }
        
        clicks = append(clicks, click)
    }
    
    if len(clicks) == 0 {
        return c.Status(fiber.StatusNotFound).SendString("No clicks found")
    }
    
    return c.JSON(clicks)
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
    
    // Define routes
    app.Post("/click", registerClick)
    app.Get("/clicks", getClicks)
    
    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}