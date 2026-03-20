package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS card_phone_associations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			credit_card TEXT NOT NULL,
			phone TEXT NOT NULL,
			UNIQUE(credit_card, phone)
		);
		CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone);
		CREATE INDEX IF NOT EXISTS idx_credit_card ON card_phone_associations(credit_card);
	`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Post("/associate_card", func(c *fiber.Ctx) error {
		type AssociateRequest struct {
			CreditCard string `json:"credit_card"`
			Phone      string `json:"phone"`
		}

		var req AssociateRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		req.CreditCard = strings.TrimSpace(req.CreditCard)
		req.Phone = strings.TrimSpace(req.Phone)

		if req.CreditCard == "" || req.Phone == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "credit_card and phone are required"})
		}

		_, err := db.Exec(
			"INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
			req.CreditCard, req.Phone,
		)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to create association"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Association created successfully"})
	})

	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		type RetrieveRequest struct {
			PhoneNumbers []string `json:"phone_numbers"`
		}

		var req RetrieveRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}

		if req.PhoneNumbers == nil || len(req.PhoneNumbers) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "phone_numbers is required and must not be empty"})
		}

		phoneCount := len(req.PhoneNumbers)
		placeholders := make([]string, phoneCount)
		args := make([]interface{}, phoneCount+1)
		for i, phone := range req.PhoneNumbers {
			placeholders[i] = "?"
			args[i] = strings.TrimSpace(phone)
		}
		args[phoneCount] = phoneCount

		query := `
			SELECT credit_card
			FROM card_phone_associations
			WHERE phone IN (` + strings.Join(placeholders, ",") + `)
			GROUP BY credit_card
			HAVING COUNT(DISTINCT phone) = ?
		`

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Query failed"})
		}
		defer rows.Close()

		var cardNumbers []string
		for rows.Next() {
			var card string
			if err := rows.Scan(&card); err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Failed to scan results"})
			}
			cardNumbers = append(cardNumbers, card)
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Row iteration error"})
		}

		if len(cardNumbers) == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Not found"})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"card_numbers": cardNumbers,
		})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}