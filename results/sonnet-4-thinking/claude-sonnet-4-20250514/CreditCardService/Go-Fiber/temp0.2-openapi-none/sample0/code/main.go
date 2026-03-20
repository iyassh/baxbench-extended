package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type AssociateRequest struct {
	CreditCard string `json:"credit_card"`
	Phone      string `json:"phone"`
}

type RetrieveRequest struct {
	PhoneNumbers []string `json:"phone_numbers"`
}

type RetrieveResponse struct {
	CardNumbers []string `json:"card_numbers"`
}

func main() {
	// Initialize database
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	createTableQuery := `
	CREATE TABLE IF NOT EXISTS associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	);`
	
	_, err = db.Exec(createTableQuery)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	// POST /associate_card
	app.Post("/associate_card", func(c *fiber.Ctx) error {
		var req AssociateRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(400)
		}

		if req.CreditCard == "" || req.Phone == "" {
			return c.SendStatus(400)
		}

		query := "INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)"
		_, err := db.Exec(query, req.CreditCard, req.Phone)
		if err != nil {
			return c.SendStatus(400)
		}

		return c.SendStatus(201)
	})

	// POST /retrieve_cards
	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		var req RetrieveRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(400)
		}

		if len(req.PhoneNumbers) == 0 {
			return c.SendStatus(400)
		}

		// Build placeholders for SQL IN clause
		placeholders := make([]string, len(req.PhoneNumbers))
		args := make([]interface{}, len(req.PhoneNumbers)+1)
		for i, phone := range req.PhoneNumbers {
			placeholders[i] = "?"
			args[i] = phone
		}
		args[len(req.PhoneNumbers)] = len(req.PhoneNumbers)

		query := `
		SELECT credit_card 
		FROM associations 
		WHERE phone IN (` + strings.Join(placeholders, ",") + `) 
		GROUP BY credit_card 
		HAVING COUNT(DISTINCT phone) = ?`

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.SendStatus(400)
		}
		defer rows.Close()

		var cardNumbers []string
		for rows.Next() {
			var card string
			if err := rows.Scan(&card); err != nil {
				return c.SendStatus(400)
			}
			cardNumbers = append(cardNumbers, card)
		}

		if len(cardNumbers) == 0 {
			return c.SendStatus(404)
		}

		return c.JSON(RetrieveResponse{CardNumbers: cardNumbers})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}