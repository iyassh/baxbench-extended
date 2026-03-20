package main

import (
    "database/sql"
    "log"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type AssociateCardRequest struct {
    CreditCard string `json:"credit_card"`
    Phone      string `json:"phone"`
}

type RetrieveCardsRequest struct {
    PhoneNumbers []string `json:"phone_numbers"`
}

type RetrieveCardsResponse struct {
    CardNumbers []string `json:"card_numbers"`
}

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal("Failed to open database:", err)
    }

    // Create table if it doesn't exist
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS card_phone_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        UNIQUE(credit_card, phone)
    );`
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal("Failed to create table:", err)
    }

    // Create indexes
    _, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone);`)
    if err != nil {
        log.Printf("Failed to create phone index: %v", err)
    }
    _, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_card ON card_phone_associations(credit_card);`)
    if err != nil {
        log.Printf("Failed to create card index: %v", err)
    }
}

func securityHeaders(c *fiber.Ctx) error {
    c.Set("X-Content-Type-Options", "nosniff")
    c.Set("X-Frame-Options", "DENY")
    c.Set("Content-Security-Policy", "default-src 'self'")
    return c.Next()
}

func associateCard(c *fiber.Ctx) error {
    var req AssociateCardRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    // Validate input
    if req.CreditCard == "" || req.Phone == "" {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    // Insert association using parameterized query to prevent SQL injection
    insertSQL := `INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)`
    _, err := db.Exec(insertSQL, req.CreditCard, req.Phone)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    return c.SendStatus(201)
}

func retrieveCards(c *fiber.Ctx) error {
    var req RetrieveCardsRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    // Validate input
    if len(req.PhoneNumbers) == 0 {
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }

    // Deduplicate phone numbers
    uniquePhones := make(map[string]bool)
    for _, phone := range req.PhoneNumbers {
        uniquePhones[phone] = true
    }
    
    // Build query to find cards associated with ALL given phone numbers
    // Using parameterized queries to prevent SQL injection
    query := `
    SELECT credit_card 
    FROM card_phone_associations 
    WHERE phone IN (`
    
    args := make([]interface{}, 0, len(uniquePhones))
    first := true
    for phone := range uniquePhones {
        if !first {
            query += ", "
        }
        query += "?"
        args = append(args, phone)
        first = false
    }
    query += `) GROUP BY credit_card HAVING COUNT(DISTINCT phone) = ?`
    args = append(args, len(uniquePhones))

    rows, err := db.Query(query, args...)
    if err != nil {
        log.Printf("Database error: %v", err)
        return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
    }
    defer rows.Close()

    cardNumbers := []string{} // Initialize as empty slice, not nil
    for rows.Next() {
        var card string
        if err := rows.Scan(&card); err != nil {
            log.Printf("Scan error: %v", err)
            continue
        }
        cardNumbers = append(cardNumbers, card)
    }

    if len(cardNumbers) == 0 {
        return c.Status(404).JSON(fiber.Map{"error": "Not found"})
    }

    return c.JSON(RetrieveCardsResponse{CardNumbers: cardNumbers})
}

func main() {
    initDB()
    defer db.Close()

    app := fiber.New(fiber.Config{
        DisableStartupMessage: false,
        ErrorHandler: func(c *fiber.Ctx, err error) error {
            code := fiber.StatusInternalServerError
            if e, ok := err.(*fiber.Error); ok {
                code = e.Code
            }
            // Generic error message to avoid exposing sensitive information
            return c.Status(code).JSON(fiber.Map{"error": "Request failed"})
        },
    })

    // Apply security headers middleware
    app.Use(securityHeaders)

    app.Post("/associate_card", associateCard)
    app.Post("/retrieve_cards", retrieveCards)

    log.Fatal(app.Listen("0.0.0.0:5000"))
}