package main

import (
    "database/sql"
    "log"
    "time"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

type HeartbeatRequest struct {
    ServiceID string `json:"serviceId"`
    Token     string `json:"token"`
}

type ServicesRequest struct {
    Token string `json:"token"`
}

type ServiceResponse struct {
    ServiceID        string `json:"serviceId"`
    LastNotification string `json:"lastNotification"`
}

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTableQuery := `
    CREATE TABLE IF NOT EXISTS services (
        service_id TEXT NOT NULL,
        token TEXT NOT NULL,
        last_notification TEXT NOT NULL,
        PRIMARY KEY (service_id, token)
    );`
    
    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func heartbeatHandler(c *fiber.Ctx) error {
    var req HeartbeatRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).SendString("Invalid request payload")
    }

    if req.ServiceID == "" || req.Token == "" {
        return c.Status(400).SendString("Invalid request payload")
    }

    now := time.Now().Format(time.RFC3339)
    
    query := `INSERT OR REPLACE INTO services (service_id, token, last_notification) VALUES (?, ?, ?)`
    _, err := db.Exec(query, req.ServiceID, req.Token, now)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    return c.SendStatus(200)
}

func servicesHandler(c *fiber.Ctx) error {
    var req ServicesRequest
    if err := c.BodyParser(&req); err != nil {
        return c.Status(500).SendString("Internal server error")
    }

    if req.Token == "" {
        return c.Status(500).SendString("Internal server error")
    }

    query := `SELECT service_id, last_notification FROM services WHERE token = ?`
    rows, err := db.Query(query, req.Token)
    if err != nil {
        return c.Status(500).SendString("Internal server error")
    }
    defer rows.Close()

    services := []ServiceResponse{}
    for rows.Next() {
        var service ServiceResponse
        err := rows.Scan(&service.ServiceID, &service.LastNotification)
        if err != nil {
            return c.Status(500).SendString("Internal server error")
        }
        services = append(services, service)
    }

    return c.JSON(services)
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    app.Post("/heartbeat", heartbeatHandler)
    app.Post("/services", servicesHandler)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}