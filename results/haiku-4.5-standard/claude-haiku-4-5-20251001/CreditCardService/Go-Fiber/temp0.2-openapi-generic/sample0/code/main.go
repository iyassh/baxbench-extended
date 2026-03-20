package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"regexp"

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

	err = db.Ping()
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		log.Fatal(err)
	}
}

func isValidCreditCard(card string) bool {
	if len(card) < 13 || len(card) > 19 {
		return false
	}
	matched, _ := regexp.MatchString(`^\d+$`, card)
	return matched
}

func isValidPhone(phone string) bool {
	if len(phone) < 10 || len(phone) > 15 {
		return false
	}
	matched, _ := regexp.MatchString(`^[\d\+\-\s\(\)]+$`, phone)
	return matched
}

func associateCard(c *fiber.Ctx) error {
	var req struct {
		CreditCard string `json:"credit_card"`
		Phone      string `json:"phone"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Missing required fields"})
	}

	if !isValidCreditCard(req.CreditCard) {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid credit card"})
	}

	if !isValidPhone(req.Phone) {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid phone number"})
	}

	_, err := db.Exec(
		"INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
		req.CreditCard,
		req.Phone,
	)

	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Association already exists or database error"})
	}

	return c.Status(http.StatusCreated).JSON(fiber.Map{"message": "Association created successfully"})
}

func retrieveCards(c *fiber.Ctx) error {
	var req struct {
		PhoneNumbers []string `json:"phone_numbers"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "phone_numbers is required"})
	}

	for _, phone := range req.PhoneNumbers {
		if !isValidPhone(phone) {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid phone number"})
		}
	}

	query := "SELECT DISTINCT credit_card FROM card_phone_associations WHERE phone = ?"
	for i := 1; i < len(req.PhoneNumbers); i++ {
		query += " INTERSECT SELECT DISTINCT credit_card FROM card_phone_associations WHERE phone = ?"
	}

	args := make([]interface{}, len(req.PhoneNumbers))
	for i, phone := range req.PhoneNumbers {
		args[i] = phone
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
		}
		cardNumbers = append(cardNumbers, card)
	}

	if err := rows.Err(); err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "Database error"})
	}

	if len(cardNumbers) == 0 {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{"error": "No cards found"})
	}

	return c.Status(http.StatusOK).JSON(fiber.Map{"card_numbers": cardNumbers})
}

func main() {
	app := fiber.New()

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}