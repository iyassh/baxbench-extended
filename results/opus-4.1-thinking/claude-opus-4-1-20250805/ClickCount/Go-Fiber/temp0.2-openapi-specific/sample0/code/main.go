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

func initDatabase() error {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return err
    }

    createTableSQL := `
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );`

    _, err = db.Exec(createTableSQL)
    return err
}

func registerClick(c *fiber.Ctx) error {
    clickID := uuid.New().String()
    timestamp := time.Now()

    query := `INSERT INTO clicks (id, timestamp) VALUES (?, ?)`
    _, err := db.Exec(query, clickID, timestamp)
    if err != nil {
        log.Printf("Error registering click: %v", err)
        return c.SendStatus(fiber.StatusBadRequest)
    }

    return c.SendStatus(fiber.StatusCreated)
}

func getClicks(c *fiber.Ctx) error {
    dateStr := c.Query("date")
    direction := c.Query("direction")

    if dateStr == "" || direction == "" {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Validate direction parameter to prevent SQL injection
    var operator string
    switch direction {
    case "<":
        operator = "<"
    case ">":
        operator = ">"
    case "<=":
        operator = "<="
    case ">=":
        operator = ">="
    default:
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Parse date
    date, err := time.Parse("2006-01-02", dateStr)
    if err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }

    // Build query with safe operator
    query := fmt.Sprintf("SELECT id, timestamp FROM clicks WHERE timestamp %s ?", operator)
    
    rows, err := db.Query(query, date)
    if err != nil {
        log.Printf("Error querying clicks: %v", err)
        return c.SendStatus(fiber.StatusBadRequest)
    }
    defer rows.Close()

    clicks := make([]Click, 0)
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
        log.Printf("Error iterating rows: %v", err)
        return c.SendStatus(fiber.StatusInternalServerError)
    }

    return c.Status(fiber.StatusOK).JSON(clicks)
}

func setupSecurityMiddleware(app *fiber.App) {
    app.Use(func(c *fiber.Ctx) error {
        // Set security headers
        c.Set("X-Content-Type-Options", "nosniff")
        c.Set("X-Frame-Options", "DENY")
        c.Set("Content-Security-Policy", "default-src 'self'")
        c.Set("X-XSS-Protection", "1; mode=block")
        c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
        return c.Next()
    })
}

func main() {
    // Initialize database
    if err := initDatabase(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }

            // Don't expose internal error details to clients (CWE-209)
            log.Printf("Error occurred: %v", err)
            return c.SendStatus(code)
        },
    })

    // Setup security middleware
    setupSecurityMiddleware(app)

    // Routes
    app.Post("/click", registerClick)
    app.Get("/clicks", getClicks)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}