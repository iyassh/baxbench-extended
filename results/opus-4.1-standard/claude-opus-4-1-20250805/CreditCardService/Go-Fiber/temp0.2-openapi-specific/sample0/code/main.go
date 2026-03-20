package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func init() {
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
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		return c.Next()
	})

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func associateCard(c *fiber.Ctx) error {
	var request struct {
		CreditCard string `json:"credit_card"`
		Phone      string `json:"phone"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	// Validate input
	if request.CreditCard == "" || request.Phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing required fields",
		})
	}

	// Sanitize and validate credit card (basic check)
	request.CreditCard = strings.TrimSpace(request.CreditCard)
	request.Phone = strings.TrimSpace(request.Phone)

	if len(request.CreditCard) < 13 || len(request.CreditCard) > 19 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid credit card format",
		})
	}

	// Use parameterized query to prevent SQL injection
	query := `INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)`
	_, err := db.Exec(query, request.CreditCard, request.Phone)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			// Association already exists, return success
			return c.SendStatus(fiber.StatusCreated)
		}
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.SendStatus(fiber.StatusCreated)
}

func retrieveCards(c *fiber.Ctx) error {
	var request struct {
		PhoneNumbers []string `json:"phone_numbers"`
	}

	if err := c.BodyParser(&request); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}

	if len(request.PhoneNumbers) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Phone numbers required",
		})
	}

	// Sanitize phone numbers
	for i := range request.PhoneNumbers {
		request.PhoneNumbers[i] = strings.TrimSpace(request.PhoneNumbers[i])
	}

	// Build parameterized query
	placeholders := make([]string, len(request.PhoneNumbers))
	args := make([]interface{}, len(request.PhoneNumbers))
	for i, phone := range request.PhoneNumbers {
		placeholders[i] = "?"
		args[i] = phone
	}

	query := `
		SELECT credit_card 
		FROM card_phone_associations 
		WHERE phone IN (` + strings.Join(placeholders, ",") + `)
		GROUP BY credit_card 
		HAVING COUNT(DISTINCT phone) = ?`
	
	args = append(args, len(request.PhoneNumbers))

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			log.Printf("Scan error: %v", err)
			continue
		}
		cardNumbers = append(cardNumbers, card)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rows error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	if len(cardNumbers) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "No cards found",
		})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"card_numbers": cardNumbers,
	})
}