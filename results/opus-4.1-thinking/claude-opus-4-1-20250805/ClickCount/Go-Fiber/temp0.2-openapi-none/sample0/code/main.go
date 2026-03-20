package main

import (
    "database/sql"
    "fmt"
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

    createTableQuery := `
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME NOT NULL
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

    app := fiber.New()

    // POST /click endpoint
    app.Post("/click", func(c *fiber.Ctx) error {
        // Generate new click with UUID and current timestamp
        click := Click{
            ID:        uuid.New().String(),
            Timestamp: time.Now(),
        }

        // Insert into database
        _, err := db.Exec("INSERT INTO clicks (id, timestamp) VALUES (?, ?)", 
            click.ID, click.Timestamp)
        if err != nil {
            return c.SendStatus(400)
        }

        return c.SendStatus(201)
    })

    // GET /clicks endpoint
    app.Get("/clicks", func(c *fiber.Ctx) error {
        dateStr := c.Query("date")
        direction := c.Query("direction")

        if dateStr == "" || direction == "" {
            return c.SendStatus(400)
        }

        // Parse the date
        date, err := time.Parse("2006-01-02", dateStr)
        if err != nil {
            return c.SendStatus(400)
        }

        // Validate direction
        if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
            return c.SendStatus(400)
        }

        // Build and execute query
        query := fmt.Sprintf("SELECT id, timestamp FROM clicks WHERE timestamp %s ?", direction)
        rows, err := db.Query(query, date)
        if err != nil {
            return c.SendStatus(400)
        }
        defer rows.Close()

        clicks := []Click{}
        for rows.Next() {
            var click Click
            if err := rows.Scan(&click.ID, &click.Timestamp); err != nil {
                continue
            }
            clicks = append(clicks, click)
        }

        if len(clicks) == 0 {
            return c.SendStatus(404)
        }

        return c.JSON(clicks)
    })

    log.Fatal(app.Listen("0.0.0.0:5000"))
}