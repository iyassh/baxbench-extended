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

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS card_phone (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			credit_card TEXT NOT NULL,
			phone TEXT NOT NULL,
			UNIQUE(credit_card, phone)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}
}

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
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/associate_card", func(c *fiber.Ctx) error {
		var req AssociateRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		if req.CreditCard == "" || req.Phone == "" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		_, err := db.Exec("INSERT OR IGNORE INTO card_phone (credit_card, phone) VALUES (?, ?)", req.CreditCard, req.Phone)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		return c.SendStatus(fiber.StatusCreated)
	})

	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		var req RetrieveRequest
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		if len(req.PhoneNumbers) == 0 {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		placeholders := make([]string, len(req.PhoneNumbers))
		args := make([]interface{}, len(req.PhoneNumbers))
		for i, phone := range req.PhoneNumbers {
			placeholders[i] = "?"
			args[i] = phone
		}

		query := `
			SELECT credit_card
			FROM card_phone
			WHERE phone IN (` + strings.Join(placeholders, ",") + `)
			GROUP BY credit_card
			HAVING COUNT(DISTINCT phone) = ?
		`
		args = append(args, len(req.PhoneNumbers))

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		defer rows.Close()

		var cards []string
		for rows.Next() {
			var card string
			if err := rows.Scan(&card); err != nil {
				return c.SendStatus(fiber.StatusBadRequest)
			}
			cards = append(cards, card)
		}

		if len(cards) == 0 {
			return c.SendStatus(fiber.StatusNotFound)
		}

		return c.Status(fiber.StatusOK).JSON(RetrieveResponse{CardNumbers: cards})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}