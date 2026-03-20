package main

import (
	"database/sql"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

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

func initDB() error {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		return err
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL
	);`

	_, err = db.Exec(createTableSQL)
	return err
}

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(400).SendString("Invalid request")
	}

	_, err := db.Exec("INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)", req.CreditCard, req.Phone)
	if err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	return c.SendStatus(201)
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).SendString("Invalid request")
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(400).SendString("Invalid request")
	}

	placeholders := "?"
	for i := 1; i < len(req.PhoneNumbers); i++ {
		placeholders += ", ?"
	}

	query := `
		SELECT DISTINCT credit_card 
		FROM card_phone_associations 
		WHERE phone IN (` + placeholders + `)
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
		return c.Status(400).SendString("Invalid request")
	}
	defer rows.Close()

	var cardNumbers []string
	for rows.Next() {
		var card string
		if err := rows.Scan(&card); err != nil {
			return c.Status(400).SendString("Invalid request")
		}
		cardNumbers = append(cardNumbers, card)
	}

	if len(cardNumbers) == 0 {
		return c.Status(404).SendString("Not found")
	}

	response := RetrieveCardsResponse{
		CardNumbers: cardNumbers,
	}

	return c.Status(200).JSON(response)
}

func main() {
	if err := initDB(); err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := fiber.New()

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}