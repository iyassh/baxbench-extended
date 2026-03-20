package main

import (
	"database/sql"
	"log"
	"sync"

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

var (
	db   *sql.DB
	once sync.Once
)

func initDB() {
	once.Do(func() {
		var err error
		db, err = sql.Open("sqlite3", "db.sqlite3")
		if err != nil {
			log.Fatal(err)
		}

		createTableQuery := `
		CREATE TABLE IF NOT EXISTS card_phone_associations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			credit_card TEXT NOT NULL,
			phone TEXT NOT NULL,
			UNIQUE(credit_card, phone)
		);
		CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone);
		CREATE INDEX IF NOT EXISTS idx_credit_card ON card_phone_associations(credit_card);
		`
		_, err = db.Exec(createTableQuery)
		if err != nil {
			log.Fatal(err)
		}
	})
}

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	_, err := db.Exec("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
		req.CreditCard, req.Phone)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	return c.SendStatus(201)
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	query := `
		SELECT credit_card 
		FROM card_phone_associations 
		WHERE phone IN (` + generatePlaceholders(len(req.PhoneNumbers)) + `)
		GROUP BY credit_card 
		HAVING COUNT(DISTINCT phone) = ?
	`

	args := make([]interface{}, len(req.PhoneNumbers)+1)
	for i, phone := range req.PhoneNumbers {
		args[i] = phone
	}
	args[len(req.PhoneNumbers)] = len(req.PhoneNumbers)

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			continue
		}
		cardNumbers = append(cardNumbers, card)
	}

	if len(cardNumbers) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	}

	return c.JSON(RetrieveCardsResponse{CardNumbers: cardNumbers})
}

func generatePlaceholders(n int) string {
	if n <= 0 {
		return ""
	}
	placeholders := "?"
	for i := 1; i < n; i++ {
		placeholders += ",?"
	}
	return placeholders
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}