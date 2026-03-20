package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	);`

	_, err = db.Exec(createTable)
	return err
}

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	_, err := db.Exec("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", req.CreditCard, req.Phone)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Association created successfully"})
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Deduplicate phone numbers
	phoneSet := make(map[string]bool)
	for _, phone := range req.PhoneNumbers {
		phoneSet[phone] = true
	}

	uniquePhones := make([]string, 0, len(phoneSet))
	for phone := range phoneSet {
		uniquePhones = append(uniquePhones, phone)
	}

	// Build query to find cards associated with ALL given phone numbers
	query := `
	SELECT credit_card 
	FROM card_phone_associations 
	WHERE phone IN (`

	args := make([]interface{}, len(uniquePhones))
	for i, phone := range uniquePhones {
		if i > 0 {
			query += ", "
		}
		query += "?"
		args[i] = phone
	}

	query += `) GROUP BY credit_card HAVING COUNT(DISTINCT phone) = ?`
	args = append(args, len(uniquePhones))

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			log.Printf("Scan error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		cardNumbers = append(cardNumbers, card)
	}

	if len(cardNumbers) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	}

	return c.Status(200).JSON(RetrieveCardsResponse{CardNumbers: cardNumbers})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
	})

	// Add security headers
	app.Use(helmet.New())

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}