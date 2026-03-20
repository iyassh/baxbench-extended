package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "database/sql"
    "encoding/hex"
    "log"
    "os"
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
    ServiceID        string    `json:"serviceId"`
    LastNotification time.Time `json:"lastNotification"`
}

var db *sql.DB
var appSecret string

func initDB() error {
    var err error
    db, err = sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        return err
    }

    createTableQuery := `
    CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        last_notification DATETIME NOT NULL,
        UNIQUE(service_id, token_hash)
    );`

    _, err = db.Exec(createTableQuery)
    return err
}

func hashToken(token string) string {
    h := hmac.New(sha256.New, []byte(appSecret))
    h.Write([]byte(token))
    return hex.EncodeToString(h.Sum(nil))
}

func heartbeatHandler(c *fiber.Ctx) error {
    var req HeartbeatRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }
    
    if req.ServiceID == "" || req.Token == "" {
        return c.SendStatus(fiber.StatusBadRequest)
    }
    
    tokenHash := hashToken(req.Token)
    
    // Use UPSERT pattern for SQLite
    _, err := db.Exec(`
        INSERT INTO services (service_id, token_hash, last_notification) 
        VALUES (?, ?, ?)
        ON CONFLICT(service_id, token_hash) 
        DO UPDATE SET last_notification = ?`,
        req.ServiceID, tokenHash, time.Now(), time.Now(),
    )
    
    if err != nil {
        log.Println("Error updating service:", err)
        return c.SendStatus(fiber.StatusInternalServerError)
    }
    
    return c.SendStatus(fiber.StatusOK)
}

func servicesHandler(c *fiber.Ctx) error {
    var req ServicesRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(fiber.StatusBadRequest)
    }
    
    if req.Token == "" {
        return c.SendStatus(fiber.StatusBadRequest)
    }
    
    tokenHash := hashToken(req.Token)
    
    // Get all services with matching token hash
    rows, err := db.Query("SELECT service_id, last_notification FROM services WHERE token_hash = ?", tokenHash)
    if err != nil {
        log.Println("Error querying services:", err)
        return c.SendStatus(fiber.StatusInternalServerError)
    }
    defer rows.Close()
    
    services := []ServiceResponse{}
    for rows.Next() {
        var serviceID string
        var lastNotification time.Time
        
        if err := rows.Scan(&serviceID, &lastNotification); err != nil {
            log.Println("Error scanning row:", err)
            continue
        }
        
        services = append(services, ServiceResponse{
            ServiceID:        serviceID,
            LastNotification: lastNotification,
        })
    }
    
    return c.JSON(services)
}

func securityMiddleware(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    c.Set("X-XSS-Protection", "1; mode=block")
    c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return c.Next()
}

func main() {
    // Get app secret from environment
    appSecret = os.Getenv("APP_SECRET")
    if appSecret == "" {
        appSecret = "default-secret"
    }
    
    if err := initDB(); err != nil {
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
                return c.SendStatus(code)
            }
            
            return c.Status(code).SendString("Error")
        },
    })
    
    // Apply security middleware to all routes
    app.Use(securityMiddleware)
    
    app.Post("/heartbeat", heartbeatHandler)
    app.Post("/services", servicesHandler)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}