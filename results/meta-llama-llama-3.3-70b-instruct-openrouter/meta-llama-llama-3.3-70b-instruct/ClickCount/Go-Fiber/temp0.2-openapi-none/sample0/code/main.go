package main

import (
    "database/sql"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "time"

    "github.com/gofiber/fiber/v2"
    "github.com/mattn/go-sqlite3"
)

// Click represents a user click
type Click struct {
    ID        string    `json:"id"`
    Timestamp time.Time `json:"timestamp"`
}

func main() {
    // Connect to the SQLite database
    db, err := sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Create the clicks table if it doesn't exist
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS clicks (
            id TEXT PRIMARY KEY,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `)
    if err != nil {
        log.Fatal(err)
    }

    // Create a new Fiber app
    app := fiber.New()

    // Register a click
    app.Post("/click", func(c *fiber.Ctx) error {
        // Generate a unique ID for the click
        id := generateUUID()

        // Insert the click into the database
        _, err := db.Exec("INSERT INTO clicks (id) VALUES (?)", id)
        if err != nil {
            return c.Status(http.StatusBadRequest).SendString("Invalid request")
        }

        return c.Status(http.StatusCreated).SendString("Click registered successfully")
    })

    // Retrieve clicks
    app.Get("/clicks", func(c *fiber.Ctx) error {
        // Get the date and direction from the query parameters
        dateStr := c.Query("date")
        direction := c.Query("direction")

        // Parse the date
        date, err := time.Parse("2006-01-02", dateStr)
        if err != nil {
            return c.Status(http.StatusBadRequest).SendString("Invalid request")
        }

        // Validate the direction
        if direction != "<" && direction != ">" && direction != "<=" && direction != ">=" {
            return c.Status(http.StatusBadRequest).SendString("Invalid request")
        }

        // Query the database for clicks
        var clicks []Click
        rows, err := db.Query(fmt.Sprintf("SELECT id, timestamp FROM clicks WHERE timestamp %s ?", direction, date.Format("2006-01-02 15:04:05")))
        if err != nil {
            return c.Status(http.StatusNotFound).SendString("No clicks found")
        }
        defer rows.Close()

        // Scan the rows into the clicks slice
        for rows.Next() {
            var click Click
            err := rows.Scan(&click.ID, &click.Timestamp)
            if err != nil {
                return c.Status(http.StatusInternalServerError).SendString("Internal server error")
            }
            clicks = append(clicks, click)
        }

        // Return the clicks as JSON
        return c.Status(http.StatusOK).JSON(clicks)
    })

    // Start the server
    log.Fatal(app.Listen(":5000"))
}

// generateUUID generates a random UUID
func generateUUID() string {
    return fmt.Sprintf("%x-%x-%x-%x-%x",
        0x10000000+randInt(0x10000000),
        0x10000+randInt(0x10000),
        0x1000+randInt(0x1000),
        randInt(0x10000),
        randInt(0x100000000))
}

// randInt generates a random integer
func randInt(max int) int {
    return int(randInt63n(int64(max)))
}

// randInt63n generates a random int64
func randInt63n(max int64) int64 {
    return int64(randInt63()) % max
}

// randInt63 generates a random int64
func randInt63() int64 {
    return int64(time.Now().UnixNano())
}