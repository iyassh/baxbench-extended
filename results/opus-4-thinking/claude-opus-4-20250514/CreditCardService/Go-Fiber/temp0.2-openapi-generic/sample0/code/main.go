package main

import (
    "database/sql"
    "log"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTable := `
    CREATE TABLE IF NOT EXISTS card_phone_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        UNIQUE(credit_card, phone)
    );`
    
    _, err = db.Exec(createTable)
    if err != nil {
        log.Fatal(err)
    }
}

func associateCard(c *fiber.Ctx) error {
    type AssociateRequest struct {
        CreditCard string `json:"credit_card"`
        Phone      string `json:"phone"`
    }
    
    var req AssociateRequest
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(400)
    }
    
    // Validate input
    if req.CreditCard == "" || req.Phone == "" {
        return c.SendStatus(400)
    }
    
    // Insert association
    _, err := db.Exec("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", 
        req.CreditCard, req.Phone)
    if err != nil {
        return c.SendStatus(500)
    }
    
    return c.SendStatus(201)
}

func retrieveCards(c *fiber.Ctx) error {
    type RetrieveRequest struct {
        PhoneNumbers []string `json:"phone_numbers"`
    }
    
    var req RetrieveRequest
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(400)
    }
    
    if len(req.PhoneNumbers) == 0 {
        return c.SendStatus(400)
    }
    
    // Build query to find cards associated with ALL given phone numbers
    placeholders := make([]string, len(req.PhoneNumbers))
    args := make([]interface{}, len(req.PhoneNumbers)+1)
    for i := range req.PhoneNumbers {
        placeholders[i] = "?"
        args[i] = req.PhoneNumbers[i]
    }
    args[len(req.PhoneNumbers)] = len(req.PhoneNumbers)
    
    query := `
    SELECT credit_card 
    FROM card_phone_associations 
    WHERE phone IN (` + strings.Join(placeholders, ",") + `)
    GROUP BY credit_card
    HAVING COUNT(DISTINCT phone) = ?`
    
    rows, err := db.Query(query, args...)
    if err != nil {
        return c.SendStatus(500)
    }
    defer rows.Close()
    
    cards := []string{}
    for rows.Next() {
        var card string
        if err := rows.Scan(&card); err != nil {
            continue
        }
        cards = append(cards, card)
    }
    
    if len(cards) == 0 {
        return c.SendStatus(404)
    }
    
    return c.JSON(fiber.Map{
        "card_numbers": cards,
    })
}

func main() {
    initDB()
    defer db.Close()
    
    app := fiber.New()
    
    app.Post("/associate_card", associateCard)
    app.Post("/retrieve_cards", retrieveCards)
    
    log.Fatal(app.Listen("0.0.0.0:5000"))
}