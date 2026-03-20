package main

import (
	"database/sql"
	"fmt"
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
	// Initialize database
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS associations (
			credit_card TEXT NOT NULL,
			phone TEXT NOT NULL,
			PRIMARY KEY (credit_card, phone)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	// Associate card endpoint
	app.Post("/associate_card", func(c *fiber.Ctx) error {
		var req AssociateCardRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(400)
		}

		if req.CreditCard == "" || req.Phone == "" {
			return c.SendStatus(400)
		}

		_, err := db.Exec("INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)",
			req.CreditCard, req.Phone)
		if err != nil {
			return c.SendStatus(400)
		}

		return c.SendStatus(201)
	})

	// Retrieve cards endpoint
	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		var req RetrieveCardsRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(400)
		}

		if len(req.PhoneNumbers) == 0 {
			return c.SendStatus(400)
		}

		// Build IN clause
		placeholders := make([]string, len(req.PhoneNumbers))
		args := make([]interface{}, len(req.PhoneNumbers))
		for i, phone := range req.PhoneNumbers {
			placeholders[i] = "?"
			args[i] = phone
		}

		query := fmt.Sprintf(`
			SELECT credit_card 
			FROM associations 
			WHERE phone IN (%s)
			GROUP BY credit_card 
			HAVING COUNT(DISTINCT phone) = ?
		`, strings.Join(placeholders, ","))

		args = append(args, len(req.PhoneNumbers))

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.SendStatus(400)
		}
		defer rows.Close()

		cardNumbers := make([]string, 0)
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

		response := RetrieveCardsResponse{CardNumbers: cardNumbers}
		return c.Status(200).JSON(response)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}