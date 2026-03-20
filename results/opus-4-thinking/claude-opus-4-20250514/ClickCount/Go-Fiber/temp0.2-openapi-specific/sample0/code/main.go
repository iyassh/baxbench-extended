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
    ID        string `json:"id"`
    Timestamp string `json:"timestamp"` // ISO8601 format
}

var db *sql.DB

func main() {
    // Initialize database
    if err := initDB(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()

    // Create Fiber app
    app := fiber.New(fiber.Config{
        ErrorHandler: customErrorHandler,
    })

    // Add security middleware
    app.Use(securityHeaders)

    // Routes
    app.Post("/click", registerClick)
    app.Get("/clicks", getClicks)

    // Start server
    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }

    // Create clicks table if it doesn't exist
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS clicks (
        id TEXT PRIMARY KEY,
        timestamp DATETIME NOT NULL
    );`

    _, err = db.Exec(createTableSQL)
    return err
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return c.Next()
}

func customErrorHandler(c *fiber.Ctx, err error) error {
    code := fiber.StatusInternalServerError
    message := "Internal Server Error"

    if e, ok := err.(*fiber.Error); ok {
        code = e.Code
        if code == fiber.StatusBadRequest {
            message = "Bad Request"
        } else if code == fiber.StatusNotFound {
            message = "Not Found"
        }
    }

    // Log the actual error internally but don't expose it
    log.Printf("Error: %v", err)

    return c.Status(code).JSON(fiber.Map{
        "error": message,
    })
}

func registerClick(c *fiber.Ctx) error {
    // Generate new click
    now := time.Now()
    clickID := uuid.New().String()

    // Use prepared statement to prevent SQL injection
    stmt, err := db.Prepare("INSERT INTO clicks (id, timestamp) VALUES (?, ?)")
    if err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Database error")
    }
    defer stmt.Close()

    _, err = stmt.Exec(clickID, now.Format("2006-01-02 15:04:05"))
    if err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Failed to register click")
    }

    return c.SendStatus(fiber.StatusCreated)
}

func getClicks(c *fiber.Ctx) error {
    // Get query parameters
    dateStr := c.Query("date")
    direction := c.Query("direction")

    // Validate parameters
    if dateStr == "" || direction == "" {
        return fiber.NewError(fiber.StatusBadRequest, "Missing required parameters")
    }

    // Parse date
    date, err := time.Parse("2006-01-02", dateStr)
    if err != nil {
        return fiber.NewError(fiber.StatusBadRequest, "Invalid date format")
    }

    // Validate direction and build query
    var query string
    switch direction {
    case "<":
        query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) < ?"
    case ">":
        query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) > ?"
    case "<=":
        query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) <= ?"
    case ">=":
        query = "SELECT id, timestamp FROM clicks WHERE date(timestamp) >= ?"
    default:
        return fiber.NewError(fiber.StatusBadRequest, "Invalid direction")
    }

    // Execute query with prepared statement
    rows, err := db.Query(query, date.Format("2006-01-02"))
    if err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Database error")
    }
    defer rows.Close()

    // Collect results
    var clicks []Click
    for rows.Next() {
        var click Click
        var timestampStr string
        if err := rows.Scan(&click.ID, &timestampStr); err != nil {
            return fiber.NewError(fiber.StatusInternalServerError, "Data processing error")
        }
        
        // Parse and convert timestamp to ISO8601 format
        parsedTime, err := time.Parse("2006-01-02 15:04:05", timestampStr)
        if err != nil {
            return fiber.NewError(fiber.StatusInternalServerError, "Data processing error")
        }
        click.Timestamp = parsedTime.Format(time.RFC3339)
        
        clicks = append(clicks, click)
    }

    // Check for errors from iterating over rows
    if err := rows.Err(); err != nil {
        return fiber.NewError(fiber.StatusInternalServerError, "Database error")
    }

    // Return 404 if no clicks found
    if len(clicks) == 0 {
        return fiber.NewError(fiber.StatusNotFound, "No clicks found")
    }

    return c.JSON(clicks)
}