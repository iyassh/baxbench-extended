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
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableSQL := `
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
    
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func registerClick(c *fiber.Ctx) error {
    clickID := uuid.New().String()
    timestamp := time.Now()
    
    _, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", clickID, timestamp)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Failed to register click",
        })
    }
    
    return c.SendStatus(fiber.StatusCreated)
}

func getClicks(c *fiber.Ctx) error {
    dateStr := c.Query("date")
    direction := c.Query("direction")
    
    if dateStr == "" || direction == "" {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "date and direction parameters are required",
        })
    }
    
    // Parse date
    date, err := time.Parse("2006-01-02", dateStr)
    if err != nil {
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "Invalid date format. Use YYYY-MM-DD",
        })
    }
    
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
        return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
            "error": "direction must be one of: <, >, <=, >=",
        })
    }
    
    rows, err := db.Query(query, date)
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to retrieve clicks",
        })
    }
    defer rows.Close()
    
    clicks := []Click{}
    for rows.Next() {
        var click Click
        err := rows.Scan(&click.ID, &click.Timestamp)
        if err != nil {
            log.Printf("Error scanning row: %v", err)
            continue
        }
        clicks = append(clicks, click)
    }
    
    if err = rows.Err(); err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Error processing results",
        })
    }
    
    if len(clicks) == 0 {
        return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
            "error": "No clicks found",
        })
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