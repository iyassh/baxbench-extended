package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTable := `
	CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL
	);`

	_, err = db.Exec(createTable)
	if err != nil {
		log.Fatal(err)
	}
}

func associateCard(c *fiber.Ctx) error {
	type Request struct {
		CreditCard string `json:"credit_card"`
		Phone      string `json:"phone"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	_, err := db.Exec("INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", req.CreditCard, req.Phone)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Association created successfully"})
}

func retrieveCards(c *fiber.Ctx) error {
	type Request struct {
		PhoneNumbers []string `json:"phone_numbers"`
	}

	var req Request
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	// Find cards associated with ALL given phone numbers
	// Strategy: find cards that appear in associations for each phone number
	// Start with cards for the first phone number, then intersect with cards for each subsequent phone number

	// Get cards for first phone
	firstPhone := req.PhoneNumbers[0]
	rows, err := db.Query("SELECT DISTINCT credit_card FROM card_phone_associations WHERE phone = ?", firstPhone)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
	}
	defer rows.Close()

	candidateCards := []string{}
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}
		candidateCards = append(candidateCards, card)
	}

	if len(candidateCards) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Not found"})
	}

	// For each remaining phone number, filter candidate cards
	for i := 1; i < len(req.PhoneNumbers); i++ {
		phone := req.PhoneNumbers[i]
		rows2, err := db.Query("SELECT DISTINCT credit_card FROM card_phone_associations WHERE phone = ?", phone)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
		}

		phoneCards := map[string]bool{}
		for rows2.Next() {
			var card string
			if err := rows2.Scan(&card); err != nil {
				rows2.Close()
				return c.Status(500).JSON(fiber.Map{"error": "Internal server error"})
			}
			phoneCards[card] = true
		}
		rows2.Close()

		// Intersect
		filtered := []string{}
		for _, card := range candidateCards {
			if phoneCards[card] {
				filtered = append(filtered, card)
			}
		}
		candidateCards = filtered

		if len(candidateCards) == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "Not found"})
		}
	}

	return c.Status(200).JSON(fiber.Map{"card_numbers": candidateCards})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}