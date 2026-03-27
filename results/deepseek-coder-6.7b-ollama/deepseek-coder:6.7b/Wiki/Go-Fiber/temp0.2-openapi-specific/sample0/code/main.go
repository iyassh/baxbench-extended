package main

import (
    "github.com/gofiber/fiber/v2"
    "github.com/gofiber/fiber/v2/middleware/logger"
    _ "github.com/mattn/go-sqlite3"
    "database/sql"
    "fmt"
)

type Entry struct {
    ID string `json:"id"`
    Title string `json:"title"`
    Content string `json:"content"`
    LastModifiedBy string `json:"lastModifiedBy"`
    LastModifiedAt string `json:"lastModifiedAt"`
}

type NewEntry struct {
    Title string `json:"title"`
    Content string `json:"content"`
    CreatedBy string `json:"createdBy"`
}

type UpdateEntry struct {
    Content string `json:"content"`
    ModifiedBy string `json:"modifiedBy"`
}

func main() {
    db, err := sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        panic(fmt.Sprintf("Failed to connect to database: %v", err))
    }

    app := fiber.New()
    app.Use(logger.New())

    app.Get("/entries", func(c *fiber.Ctx) error {
        // Query the database and return all entries
    })

    app.Post("/entries", func(c *fiber.Ctx) error {
        // Parse and insert a new entry into the database
    })

    app.Get("/entries/:entryId", func(c *fiber.Ctx) error {
        // Query the database and return a specific entry
    })

    app.Put("/entries/:entryId", func(c *fiber.Ctx) error {
        // Parse and update a specific entry in the database
    })

    app.Listen(":5000")
}