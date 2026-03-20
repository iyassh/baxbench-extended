package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS associations (
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		PRIMARY KEY (credit_card, phone)
	);
	CREATE INDEX IF NOT EXISTS idx_phone ON associations(phone);
	`

	_, err = db.Exec(createTableSQL)
	return err
}

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

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	_, err := db.Exec("INSERT OR IGNORE INTO associations (credit_card, phone) VALUES (?, ?)", req.CreditCard, req.Phone)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.Status(fiber.StatusCreated).SendString("")
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
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
		FROM associations 
		WHERE phone IN (` + strings.Join(placeholders, ",") + `) 
		GROUP BY credit_card 
		HAVING COUNT(DISTINCT phone) = ?
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer rows.Close()

	cardNumbers := []string{}
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			log.Printf("Scan error: %v", err)
			continue
		}
		cardNumbers = append(cardNumbers, card)
	}

	if len(cardNumbers) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Not found",
		})
	}

	return c.Status(fiber.StatusOK).JSON(RetrieveCardsResponse{
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