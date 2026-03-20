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

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	)`)
	if err != nil {
		return err
	}

	return nil
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
		log.Printf("Error inserting association: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{})
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

	// Build parameterized query to find cards associated with ALL given phone numbers
	placeholders := make([]string, len(req.PhoneNumbers))
	args := make([]interface{}, len(req.PhoneNumbers))
	for i, phone := range req.PhoneNumbers {
		placeholders[i] = "?"
		args[i] = phone
	}

	count := len(req.PhoneNumbers)
	args = append(args, count)

	query := `SELECT credit_card FROM card_phone_associations
		WHERE phone IN (` + strings.Join(placeholders, ",") + `)
		GROUP BY credit_card
		HAVING COUNT(DISTINCT phone) = ?`

	rows, err := db.Query(query, args...)
	if err != nil {
		log.Printf("Error querying associations: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	cardNumbers := []string{}
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			log.Printf("Error scanning row: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		cardNumbers = append(cardNumbers, card)
	}

	if err := rows.Err(); err != nil {
		log.Printf("Error iterating rows: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
	}

	if len(cardNumbers) == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "No cards found"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{"card_numbers": cardNumbers})
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		},
	})

	// Security headers middleware
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		return c.Next()
	})

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}