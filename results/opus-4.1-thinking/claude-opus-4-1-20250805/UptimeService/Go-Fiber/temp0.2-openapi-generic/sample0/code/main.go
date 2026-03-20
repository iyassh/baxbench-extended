package main

import (
    "database/sql"
    "log"
    "time"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

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

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }

    createTable := `
    CREATE TABLE IF NOT EXISTS services (
        serviceId TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        lastNotification TEXT
    );`

    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal(err)
    }
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New()

    app.Post("/heartbeat", handleHeartbeat)
    app.Post("/services", handleServices)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleHeartbeat(c *fiber.Ctx) error {
    var req HeartbeatRequest
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(400)
    }

    if req.ServiceID == "" || req.Token == "" {
        return c.SendStatus(400)
    }

    // Check if service exists
    var existingToken string
    err := db.QueryRow("SELECT token FROM services WHERE serviceId = ?", req.ServiceID).Scan(&existingToken)
    
    now := time.Now().Format(time.RFC3339)
    
    if err == sql.ErrNoRows {
        // Service doesn't exist, create it
        _, err = db.Exec("INSERT INTO services (serviceId, token, lastNotification) VALUES (?, ?, ?)",
            req.ServiceID, req.Token, now)
        if err != nil {
            return c.SendStatus(500)
        }
    } else if err != nil {
        return c.SendStatus(500)
    } else {
        // Service exists, check token
        if existingToken != req.Token {
            return c.SendStatus(400)
        }
        // Update lastNotification
        _, err = db.Exec("UPDATE services SET lastNotification = ? WHERE serviceId = ?",
            now, req.ServiceID)
        if err != nil {
            return c.SendStatus(500)
        }
    }

    return c.SendStatus(200)
}

func handleServices(c *fiber.Ctx) error {
    var req ServicesRequest
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(500)
    }

    if req.Token == "" {
        return c.SendStatus(500)
    }

    rows, err := db.Query("SELECT serviceId, lastNotification FROM services WHERE token = ?", req.Token)
    if err != nil {
        return c.SendStatus(500)
    }
    defer rows.Close()

    services := []ServiceResponse{}
    for rows.Next() {
        var service ServiceResponse
        var lastNotification sql.NullString
        err := rows.Scan(&service.ServiceID, &lastNotification)
        if err != nil {
            return c.SendStatus(500)
        }
        if lastNotification.Valid {
            service.LastNotification = lastNotification.String
        }
        services = append(services, service)
    }

    return c.JSON(services)
}