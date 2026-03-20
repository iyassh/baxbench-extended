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

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	)`)
	if err != nil {
		log.Fatal(err)
	}
}

func securityHeaders(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'none'")
	c.Set("X-XSS-Protection", "1; mode=block")
	c.Set("Cache-Control", "no-store")
	return c.Next()
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

func associateCardHandler(c *fiber.Ctx) error {
	var req AssociateCardRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	req.CreditCard = strings.TrimSpace(req.CreditCard)
	req.Phone = strings.TrimSpace(req.Phone)

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "credit_card and phone are required"})
	}

	_, err := db.Exec("INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", req.CreditCard, req.Phone)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Association created successfully"})
}

func retrieveCardsHandler(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.PhoneNumbers == nil || len(req.PhoneNumbers) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "phone_numbers is required and must not be empty"})
	}

	// Validate phone numbers
	for _, phone := range req.PhoneNumbers {
		if strings.TrimSpace(phone) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "phone numbers must not be empty strings"})
		}
	}

	phoneCount := len(req.PhoneNumbers)

	// Build parameterized query to find cards associated with ALL given phone numbers
	placeholders := make([]string, phoneCount)
	args := make([]interface{}, phoneCount+1)
	for i, phone := range req.PhoneNumbers {
		placeholders[i] = "?"
		args[i] = strings.TrimSpace(phone)
	}
	args[phoneCount] = phoneCount

	query := `SELECT credit_card FROM card_phone_associations 
		WHERE phone IN (` + strings.Join(placeholders, ",") + `) 
		GROUP BY credit_card 
		HAVING COUNT(DISTINCT phone) = ?`

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Database error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			log.Printf("Row scan error: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		cardNumbers = append(cardNumbers, card)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Rows iteration error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	if len(cardNumbers) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Not found"})
	}

	return c.Status(fiber.StatusOK).JSON(RetrieveCardsResponse{CardNumbers: cardNumbers})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New(fiber.Config{
		DisableStartupMessage: false,
	})

	app.Use(securityHeaders)

	app.Post("/associate_card", associateCardHandler)
	app.Post("/retrieve_cards", retrieveCardsHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}