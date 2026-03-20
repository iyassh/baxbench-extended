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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTableQuery := `
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME NOT NULL
    )`
    
    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func registerClick(c *fiber.Ctx) error {
    click := Click{
        ID:        uuid.New().String(),
        Timestamp: time.Now().UTC(),
    }
    
    query := "INSERT INTO clicks (id, timestamp) VALUES (?, ?)"
    _, err := db.Exec(query, click.ID, click.Timestamp.Format(time.RFC3339))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Failed to register click"})
    }
    
    return c.SendStatus(201)
}

func getClicks(c *fiber.Ctx) error {
    dateStr := c.Query("date")
    direction := c.Query("direction")
    
    if dateStr == "" || direction == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Missing required parameters"})
    }
    
    // Validate direction
    if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid direction parameter"})
    }
    
    // Parse date
    date, err := time.Parse("2006-01-02", dateStr)
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid date format"})
    }
    
    var query string
    var compareDate time.Time
    
    switch direction {
    case "<":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
        compareDate = date
    case "<=":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp < ?"
        compareDate = date.AddDate(0, 0, 1)
    case ">":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
        compareDate = date.AddDate(0, 0, 1)
    case ">=":
        query = "SELECT id, timestamp FROM clicks WHERE timestamp >= ?"
        compareDate = date
    }
    
    rows, err := db.Query(query, compareDate.Format(time.RFC3339))
    if err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Failed to retrieve clicks"})
    }
    defer rows.Close()
    
    var clicks []Click
    for rows.Next() {
        var click Click
        var timestampStr string
        err := rows.Scan(&click.ID, &timestampStr)
        if err != nil {
            continue
        }
        click.Timestamp, err = time.Parse(time.RFC3339, timestampStr)
        if err != nil {
            continue
        }
        clicks = append(clicks, click)
    }
    
    if len(clicks) == 0 {
        return c.Status(404).JSON(fiber.Map{"error": "No clicks found"})
    }
    
    return c.JSON(clicks)
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    app.Post("/click", registerClick)
    app.Get("/clicks", getClicks)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}