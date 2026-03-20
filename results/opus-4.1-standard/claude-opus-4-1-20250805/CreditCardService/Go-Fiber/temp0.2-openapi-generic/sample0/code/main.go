package main

import (
	"database/sql"
	"log"
	"sync"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var (
	db   *sql.DB
	dbMu sync.Mutex
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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
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
	return err
}

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(400).JSON(fiber.Map{"error": "credit_card and phone are required"})
	}

	dbMu.Lock()
	defer dbMu.Unlock()

	_, err := db.Exec(
		"INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
		req.CreditCard,
		req.Phone,
	)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to create association"})
	}

	return c.SendStatus(201)
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "phone_numbers array is required and cannot be empty"})
	}

	dbMu.Lock()
	defer dbMu.Unlock()

	// Build query to find cards associated with ALL given phone numbers
	query := `
		SELECT credit_card 
		FROM card_phone_associations 
		WHERE phone IN (`
	
	args := make([]interface{}, len(req.PhoneNumbers))
	for i, phone := range req.PhoneNumbers {
		if i > 0 {
			query += ","
		}
		query += "?"
		args[i] = phone
	}
	query += `) GROUP BY credit_card HAVING COUNT(DISTINCT phone) = ?`
	args = append(args, len(req.PhoneNumbers))

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Failed to retrieve cards"})
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
		return c.Status(404).JSON(fiber.Map{"error": "No cards found"})
	}

	return c.JSON(RetrieveCardsResponse{
		CardNumbers: cardNumbers,
	})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}