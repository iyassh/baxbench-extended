package main

import (
	"database/sql"
	"fmt"
	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

type Card struct {
	CreditCard string `json:"credit_card"`
	Phone      string `json:"phone"`
}

type PhoneNumbers struct {
	PhoneNumbers []string `json:"phone_numbers"`
}

func main() {
	db, _ := sql.Open("sqlite3", "db.sqlite3")
	app := fiber.New()

	app.Post("/associate_card", func(c *fiber.Ctx) error {
		var card Card
		c.BodyParser(&card)
		stmt, _ := db.Prepare("INSERT INTO cards (credit_card, phone) VALUES (?, ?)")
		_, err := stmt.Exec(card.CreditCard, card.Phone)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}
		return c.SendStatus(201)
	})

	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		var phones PhoneNumbers
		c.BodyParser(&phones)
		query := fmt.Sprintf("SELECT credit_card FROM cards WHERE phone IN (%s) GROUP BY credit_card HAVING COUNT(*) = %d", 
			formatQuotedStrings(phones.PhoneNumbers), len(phones.PhoneNumbers))
		rows, err := db.Query(query)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}
		defer rows.Close()
		cards := []string{}
		for rows.Next() {
			var card string
			rows.Scan(&card)
			cards = append(cards, card)
		}
		if len(cards) == 0 {
			return c.Status(404).SendString("Not found")
		}
		return c.JSON(fiber.Map{"card_numbers": cards})
	})

	app.Listen("0.0.0.0:5000")
}

func formatQuotedStrings(strings []string) string {
	formatted := ""
	for _, str := range strings {
		formatted += fmt.Sprintf("'%s',", str)
	}
	return formatted[:len(formatted)-1]
}