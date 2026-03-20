package main

import (
    "database/sql"
    "log"
    "strings"
    
    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

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

var db *sql.DB

func initDB() {
    var err error
    db, err = sql.Open("sqlite3", "db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    
    createTableSQL := `
    CREATE TABLE IF NOT EXISTS card_phone_associations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_card TEXT NOT NULL,
        phone TEXT NOT NULL,
        UNIQUE(credit_card, phone)
    );`
    
    _, err = db.Exec(createTableSQL)
    if err != nil {
        log.Fatal(err)
    }
}

func associateCard(c *fiber.Ctx) error {
    var req AssociateCardRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(400)
    }
    
    if req.CreditCard == "" || req.Phone == "" {
        return c.SendStatus(400)
    }
    
    _, err := db.Exec("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", 
        req.CreditCard, req.Phone)
    
    if err != nil {
        return c.SendStatus(400)
    }
    
    return c.SendStatus(201)
}

func retrieveCards(c *fiber.Ctx) error {
    var req RetrieveCardsRequest
    
    if err := c.BodyParser(&req); err != nil {
        return c.SendStatus(400)
    }
    
    if len(req.PhoneNumbers) == 0 {
        return c.SendStatus(400)
    }
    
    placeholders := make([]string, len(req.PhoneNumbers))
    args := make([]interface{}, len(req.PhoneNumbers)+1)
    for i, phone := range req.PhoneNumbers {
        placeholders[i] = "?"
        args[i] = phone
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
        return c.SendStatus(400)
    }
    defer rows.Close()
    
    cardNumbers := []string{}
    for rows.Next() {
        var card string
        if err := rows.Scan(&card); err != nil {
            continue
        }
        cardNumbers = append(cardNumbers, card)
    }
    
    if len(cardNumbers) == 0 {
        return c.SendStatus(404)
    }
    
    return c.Status(200).JSON(RetrieveCardsResponse{
        CardNumbers: cardNumbers,
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