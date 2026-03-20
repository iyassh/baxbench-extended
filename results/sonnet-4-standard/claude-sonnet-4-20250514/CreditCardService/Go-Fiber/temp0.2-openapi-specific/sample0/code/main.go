package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request format"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	stmt, err := db.Prepare("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)")
	if err != nil {
		log.Printf("Database prepare error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer stmt.Close()

	_, err = stmt.Exec(req.CreditCard, req.Phone)
	if err != nil {
		log.Printf("Database execution error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Association created successfully"})
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request format"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
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
		log.Printf("Database query error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var cardNumber string
		if err := rows.Scan(&cardNumber); err != nil {
			log.Printf("Database scan error: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		cardNumbers = append(cardNumbers, cardNumber)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Database rows error: %v", err)
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	if len(cardNumbers) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	}

	response := RetrieveCardsResponse{
		CardNumbers: cardNumbers,
	}

	return c.Status(200).JSON(response)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))

	app.Use(recover.New())

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}