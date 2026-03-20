package main

import (
    "crypto/sha256"
    "database/sql"
    "encoding/hex"
    "log"
    "os"
    "time"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB
var appSecret string

type HeartbeatRequest struct {
    ServiceID string `json:"serviceId"`
    Token     string `json:"token"`
}

type ServicesRequest struct {
    Token string `json:"token"`
}

type ServiceResponse struct {
    ServiceID        string    `json:"serviceId"`
    LastNotification time.Time `json:"lastNotification"`
}

func initDatabase() error {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        return err
    }
    
    createTableQuery := `
    CREATE TABLE IF NOT EXISTS heartbeats (
        serviceId TEXT NOT NULL,
        tokenHash TEXT NOT NULL,
        lastNotification DATETIME NOT NULL,
        PRIMARY KEY (serviceId, tokenHash)
    )`
    
    _, err = db.Exec(createTableQuery)
    return err
}

func hashToken(token string) string {
    h := sha256.New()
    h.Write([]byte(appSecret + token))
    return hex.EncodeToString(h.Sum(nil))
}

func securityHeadersMiddleware(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.Next()
}

func heartbeatHandler(c *fiber.Ctx) error {
    var req HeartbeatRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
    }
    
    if req.ServiceID == "" || req.Token == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Missing required fields"})
    }
    
    tokenHash := hashToken(req.Token)
    now := time.Now()
    
    // Use UPSERT pattern for SQLite
    _, err := db.Exec(
        `INSERT INTO heartbeats (serviceId, tokenHash, lastNotification) 
         VALUES (?, ?, ?)
         ON CONFLICT(serviceId, tokenHash) 
         DO UPDATE SET lastNotification = ?`,
        req.ServiceID, tokenHash, now, now,
    )
    
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    
    return c.SendStatus(200)
}

func servicesHandler(c *fiber.Ctx) error {
    var req ServicesRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload"})
    }
    
    if req.Token == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Missing required field"})
    }
    
    tokenHash := hashToken(req.Token)
    
    rows, err := db.Query(
        "SELECT serviceId, lastNotification FROM heartbeats WHERE tokenHash = ?",
        tokenHash,
    )
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    defer rows.Close()
    
    services := []ServiceResponse{}
    
    for rows.Next() {
        var service ServiceResponse
        
        if err := rows.Scan(&service.ServiceID, &service.LastNotification); err != nil {
            log.Printf("Scan error: %v", err)
            continue
        }
        
        services = append(services, service)
    }
    
    if err := rows.Err(); err != nil {
        log.Printf("Rows error: %v", err)
        return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
    }
    
    return c.JSON(services)
}

func main() {
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret-for-hashing"
    }
    
    if err := initDatabase(); err != nil {
        log.Fatal("Failed to initialize database:", err)
    }
    defer db.Close()
    
    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            
            // Don't expose internal error details
            if code == fiber.StatusInternalServerError {
                return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
            }
            
            return c.Status(code).JSON(fiber.Map{"error": "Request failed"})
        },
    })
    
    app.Use(securityHeadersMiddleware)
    
    app.Post("/heartbeat", heartbeatHandler)
    app.Post("/services", servicesHandler)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}