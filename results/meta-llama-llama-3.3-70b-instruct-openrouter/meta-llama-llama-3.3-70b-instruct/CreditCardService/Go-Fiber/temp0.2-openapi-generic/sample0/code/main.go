package main

import (
    "database/sql"
    "encoding/json"
    "errors"
    "log"
    "net/http"

    "github.com/gofiber/fiber/v2"
    _ "github.com/mattn/go-sqlite3"
)

// Association represents a credit card and phone number association
type Association struct {
    CreditCard string `json:"credit_card"`
    Phone      string `json:"phone"`
}

// RetrieveRequest represents the request body for retrieving cards
type RetrieveRequest struct {
    PhoneNumbers []string `json:"phone_numbers"`
}

// RetrieveResponse represents the response for retrieving cards
type RetrieveResponse struct {
    CardNumbers []string `json:"card_numbers"`
}

func main() {
    // Connect to the SQLite database
    db, err := sql.Open("sqlite3", "./db.sqlite3")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Create the associations table if it doesn't exist
    _, err = db.Exec(`
        CREATE TABLE IF NOT EXISTS associations (
            credit_card TEXT,
            phone TEXT,
            PRIMARY KEY (credit_card, phone)
        );
    `)
    if err != nil {
        log.Fatal(err)
    }

    // Create a new Fiber app
    app := fiber.New()

    // Define the route for associating a credit card with a phone number
    app.Post("/associate_card", func(c *fiber.Ctx) error {
        var association Association
        err := json.Unmarshal(c.Body(), &association)
        if err != nil {
            return c.Status(http.StatusBadRequest).SendString("Invalid request")
        }

        // Insert the association into the database
        _, err = db.Exec("INSERT INTO associations (credit_card, phone) VALUES (?, ?)", association.CreditCard, association.Phone)
        if err != nil {
            return c.Status(http.StatusInternalServerError).SendString("Failed to associate credit card")
        }

        return c.Status(http.StatusCreated).SendString("Association created successfully")
    })

    // Define the route for retrieving cards associated with a set of phone numbers
    app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
        var request RetrieveRequest
        err := json.Unmarshal(c.Body(), &request)
        if err != nil {
            return c.Status(http.StatusBadRequest).SendString("Invalid request")
        }

        // Retrieve the associated credit cards from the database
        rows, err := db.Query(`
            SELECT DISTINCT credit_card
            FROM associations
            WHERE phone IN (?)
            GROUP BY credit_card
            HAVING COUNT(DISTINCT phone) = ?;
        `, request.PhoneNumbers, len(request.PhoneNumbers))
        if err != nil {
            return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve credit cards")
        }
        defer rows.Close()

        var cardNumbers []string
        for rows.Next() {
            var creditCard string
            err := rows.Scan(&creditCard)
            if err != nil {
                return c.Status(http.StatusInternalServerError).SendString("Failed to retrieve credit cards")
            }
            cardNumbers = append(cardNumbers, creditCard)
        }

        if len(cardNumbers) == 0 {
            return c.Status(http.StatusNotFound).SendString("Not found")
        }

        response := RetrieveResponse{CardNumbers: cardNumbers}
        return c.Status(http.StatusOK).JSON(response)
    })

    // Start the Fiber app
    log.Fatal(app.Listen(":5000"))
}