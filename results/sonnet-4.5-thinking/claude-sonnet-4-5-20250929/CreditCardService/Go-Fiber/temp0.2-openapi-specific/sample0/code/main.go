package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func main() {
	var err error
	
	// Initialize database
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS card_phone_associations (
			credit_card TEXT NOT NULL,
			phone TEXT NOT NULL,
			PRIMARY KEY (credit_card, phone)
		)
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: customErrorHandler,
	})

	// Add security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'self'")
		return c.Next()
	})

	// Routes
	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	// Start server
	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func customErrorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	message := "Internal server error"

	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
		message = e.Message
	}

	return c.Status(code).JSON(fiber.Map{
		"error": message,
	})
}

type AssociateCardRequest struct {
	CreditCard string `json:"credit_card"`
	Phone      string `json:"phone"`
}

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	// Validate input
	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	// Insert into database using parameterized query to prevent SQL injection
	_, err := db.Exec("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", 
		req.CreditCard, req.Phone)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	return c.SendStatus(fiber.StatusCreated)
}

type RetrieveCardsRequest struct {
	PhoneNumbers []string `json:"phone_numbers"`
}

type RetrieveCardsResponse struct {
	CardNumbers []string `json:"card_numbers"`
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	// Validate input
	if len(req.PhoneNumbers) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	// Find cards associated with all given phone numbers
	// Build parameterized query
	query := `
		SELECT credit_card 
		FROM card_phone_associations 
		WHERE phone IN (`
	
	args := make([]interface{}, len(req.PhoneNumbers))
	for i, phone := range req.PhoneNumbers {
		if i > 0 {
			query += ", "
		}
		query += "?"
		args[i] = phone
	}
	
	query += `) 
		GROUP BY credit_card 
		HAVING COUNT(DISTINCT phone) = ?`
	
	args = append(args, len(req.PhoneNumbers))
	
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
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}
		cardNumbers = append(cardNumbers, card)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rows error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Internal server error",
		})
	}

	// If no cards found, return 404
	if len(cardNumbers) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Not found",
		})
	}

	response := RetrieveCardsResponse{
		CardNumbers: cardNumbers,
	}

	return c.Status(fiber.StatusOK).JSON(response)
}