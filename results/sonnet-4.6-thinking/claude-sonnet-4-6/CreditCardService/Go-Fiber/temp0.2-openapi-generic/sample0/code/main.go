package main

import (
	"database/sql"
	"log"

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
	type Request struct {
		CreditCard string `json:"credit_card"`
		Phone      string `json:"phone"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "credit_card and phone are required"})
	}

	_, err := db.Exec(
		"INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
		req.CreditCard, req.Phone,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to store association"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Association created successfully"})
}

func retrieveCards(c *fiber.Ctx) error {
	type Request struct {
		PhoneNumbers []string `json:"phone_numbers"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "phone_numbers is required and must not be empty"})
	}

	// Build a query that finds credit cards associated with ALL given phone numbers
	// We use a GROUP BY + HAVING COUNT approach
	phoneCount := len(req.PhoneNumbers)

	// Build placeholders
	placeholders := make([]interface{}, phoneCount)
	for i, p := range req.PhoneNumbers {
		placeholders[i] = p
	}

	query := `
		SELECT credit_card
		FROM card_phone_associations
		WHERE phone IN (`
	for i := 0; i < phoneCount; i++ {
		if i > 0 {
			query += ","
		}
		query += "?"
	}
	query += `)
		GROUP BY credit_card
		HAVING COUNT(DISTINCT phone) = ?`

	placeholders = append(placeholders, phoneCount)

	rows, err := db.Query(query, placeholders...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Database query failed"})
	}
	defer rows.Close()

	var cards []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to scan results"})
		}
		cards = append(cards, card)
	}

	if err := rows.Err(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Error reading results"})
	}

	if len(cards) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No cards found"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"card_numbers": cards})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}