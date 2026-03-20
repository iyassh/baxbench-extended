package main

import (
	"database/sql"
	"encoding/json"
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

func main() {
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

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

	app := fiber.New()

	app.Post("/associate_card", func(c *fiber.Ctx) error {
		var req AssociateCardRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if req.CreditCard == "" || req.Phone == "" {
			return c.Status(400).JSON(fiber.Map{"error": "credit_card and phone are required"})
		}

		_, err := db.Exec("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", req.CreditCard, req.Phone)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Database error"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Association created successfully"})
	})

	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		var req RetrieveCardsRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid JSON"})
		}

		if len(req.PhoneNumbers) == 0 {
			return c.Status(400).JSON(fiber.Map{"error": "phone_numbers is required and cannot be empty"})
		}

		placeholders := strings.Repeat("?,", len(req.PhoneNumbers))
		placeholders = placeholders[:len(placeholders)-1]

		query := `
		SELECT credit_card 
		FROM card_phone_associations 
		WHERE phone IN (` + placeholders + `) 
		GROUP BY credit_card 
		HAVING COUNT(DISTINCT phone) = ?`

		args := make([]interface{}, len(req.PhoneNumbers)+1)
		for i, phone := range req.PhoneNumbers {
			args[i] = phone
		}
		args[len(req.PhoneNumbers)] = len(req.PhoneNumbers)

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Database error"})
		}
		defer rows.Close()

		var cardNumbers []string
		for rows.Next() {
			var cardNumber string
			if err := rows.Scan(&cardNumber); err != nil {
				return c.Status(400).JSON(fiber.Map{"error": "Database error"})
			}
			cardNumbers = append(cardNumbers, cardNumber)
		}

		if len(cardNumbers) == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "Not found"})
		}

		response := RetrieveCardsResponse{
			CardNumbers: cardNumbers,
		}

		return c.Status(200).JSON(response)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}