package main

import (
	"database/sql"
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "github.com/mattn/go-sqlite3"
)

type Card struct {
	CreditCard string `json:"credit_card"`
	Phone      string `json:"phone"`
}

type Cards struct {
	CardNumbers []string `json:"card_numbers"`
}

type Phones struct {
	PhoneNumbers []string `json:"phone_numbers"`
}

func main() {
	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS cards (credit_card TEXT, phone TEXT)`)
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()
	app.Use(logger.New())

	app.Post("/associate_card", func(c *fiber.Ctx) error {
		var card Card
		if err := c.BodyParser(&card); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		_, err = db.Exec("INSERT INTO cards (credit_card, phone) VALUES (?, ?)", card.CreditCard, card.Phone)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		return c.SendStatus(fiber.StatusCreated)
	})

	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		var phones Phones
		if err := c.BodyParser(&phones); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		query := "SELECT credit_card FROM cards WHERE phone IN (" + strings.Repeat("?,", len(phones.PhoneNumbers)-1) + "?) GROUP BY credit_card HAVING COUNT(*) = ?"
		args := make([]interface{}, len(phones.PhoneNumbers)+1)
		for i, phone := range phones.PhoneNumbers {
			args[i] = phone
		}
		args[len(args)-1] = len(phones.PhoneNumbers)
		rows, err := db.Query(query, args...)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		defer rows.Close()

		cards := Cards{}
		for rows.Next() {
			var card string
			err = rows.Scan(&card)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).SendString(err.Error())
			}
			cards.CardNumbers = append(cards.CardNumbers, card)
		}

		if err = rows.Err(); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}

		return c.Status(fiber.StatusOK).JSON(cards)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Fatal(app.Listen(":" + port))
}