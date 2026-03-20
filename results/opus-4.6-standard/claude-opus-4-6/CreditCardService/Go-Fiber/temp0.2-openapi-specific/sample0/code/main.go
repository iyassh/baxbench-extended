package main

import (
	"database/sql"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	)`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New(fiber.Config{
		// Disable detailed error messages to avoid CWE-209
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{"error": "An error occurred"})
		},
	})

	// Security headers middleware (CWE-693)
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Cache-Control", "no-store")
		return c.Next()
	})

	app.Post("/associate_card", func(c *fiber.Ctx) error {
		type AssociateRequest struct {
			CreditCard string `json:"credit_card"`
			Phone      string `json:"phone"`
		}

		var req AssociateRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}

		if strings.TrimSpace(req.CreditCard) == "" || strings.TrimSpace(req.Phone) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}

		// Using parameterized query to prevent SQL injection (CWE-89)
		_, err := db.Exec(
			"INSERT OR IGNORE INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
			req.CreditCard, req.Phone,
		)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"message": "Association created successfully"})
	})

	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		type RetrieveRequest struct {
			PhoneNumbers []string `json:"phone_numbers"`
		}

		var req RetrieveRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}

		if len(req.PhoneNumbers) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}

		// Build parameterized query to find cards associated with ALL given phone numbers
		// Using parameterized queries to prevent SQL injection (CWE-89)
		placeholders := make([]string, len(req.PhoneNumbers))
		args := make([]interface{}, len(req.PhoneNumbers))
		for i, phone := range req.PhoneNumbers {
			placeholders[i] = "?"
			args[i] = phone
		}

		query := `SELECT credit_card FROM card_phone_associations 
			WHERE phone IN (` + strings.Join(placeholders, ",") + `) 
			GROUP BY credit_card 
			HAVING COUNT(DISTINCT phone) = ?`
		args = append(args, len(req.PhoneNumbers))

		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}
		defer rows.Close()

		var cardNumbers []string
		for rows.Next() {
			var card string
			if err := rows.Scan(&card); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
			}
			cardNumbers = append(cardNumbers, card)
		}

		if err := rows.Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Internal server error"})
		}

		if len(cardNumbers) == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Not found"})
		}

		return c.Status(fiber.StatusOK).JSON(fiber.Map{"card_numbers": cardNumbers})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}