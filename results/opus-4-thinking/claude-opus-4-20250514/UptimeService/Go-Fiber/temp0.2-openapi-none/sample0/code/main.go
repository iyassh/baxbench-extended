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
        service_id TEXT,
        token TEXT,
        last_notification TEXT,
        PRIMARY KEY (service_id, token)
    )`
    
    _, err = db.Exec(createTableQuery)
    if err != nil {
        log.Fatal(err)
    }
}

func heartbeatHandler(c *fiber.Ctx) error {
    var req HeartbeatRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(400)
    }
    
    if req.ServiceID == "" || req.Token == "" {
        return c.SendStatus(400)
    }
    
    query := `
    INSERT INTO services (service_id, token, last_notification) 
    VALUES (?, ?, ?) 
    ON CONFLICT(service_id, token) 
    DO UPDATE SET last_notification = ?`
    
    now := time.Now().UTC().Format(time.RFC3339)
    _, err := db.Exec(query, req.ServiceID, req.Token, now, now)
    if err != nil {
        log.Println("Database error:", err)
        return c.SendStatus(500)
    }
    
    return c.SendStatus(200)
}

func servicesHandler(c *fiber.Ctx) error {
    var req ServicesRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(400)
    }
    
    if req.Token == "" {
        return c.SendStatus(400)
    }
    
    query := `SELECT service_id, last_notification FROM services WHERE token = ?`
    
    rows, err := db.Query(query, req.Token)
    if err != nil {
        log.Println("Database error:", err)
        return c.SendStatus(500)
    }
    defer rows.Close()
    
    services := []ServiceResponse{}
    
    for rows.Next() {
        var service ServiceResponse
        
        err := rows.Scan(&service.ServiceID, &service.LastNotification)
        if err != nil {
            log.Println("Scan error:", err)
            return c.SendStatus(500)
        }
        
        services = append(services, service)
    }
    
    if err = rows.Err(); err != nil {
        log.Println("Rows error:", err)
        return c.SendStatus(500)
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