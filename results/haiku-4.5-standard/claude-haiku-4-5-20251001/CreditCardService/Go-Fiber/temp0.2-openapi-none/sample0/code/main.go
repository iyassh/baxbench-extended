package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"

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
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	_, err := db.Exec(
		"INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)",
		req.CreditCard,
		req.Phone,
	)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	return c.Status(http.StatusCreated).JSON(fiber.Map{})
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	query := `
	SELECT DISTINCT credit_card FROM card_phone_associations
	WHERE phone IN (` + placeholders(len(req.PhoneNumbers)) + `)
	GROUP BY credit_card
	HAVING COUNT(DISTINCT phone) = ?
	`

	args := make([]interface{}, len(req.PhoneNumbers)+1)
	for i, phone := range req.PhoneNumbers {
		args[i] = phone
	}
	args[len(req.PhoneNumbers)] = len(req.PhoneNumbers)

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}
		cardNumbers = append(cardNumbers, card)
	}

	if err := rows.Err(); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	if len(cardNumbers) == 0 {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{"error": "Not found"})
	}

	response := RetrieveCardsResponse{
		CardNumbers: cardNumbers,
	}

	return c.Status(http.StatusOK).JSON(response)
}

func placeholders(count int) string {
	if count == 0 {
		return ""
	}
	result := "?"
	for i := 1; i < count; i++ {
		result += ",?"
	}
	return result
}

func main() {
	app := fiber.New()

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}