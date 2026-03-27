package main

import (
	"database/sql"
	"fmt"
	"os"

	"github.<｜begin▁of▁sentence｜>/fiber/v2"
	"github.<｜begin▁of▁sentence｜>/x/crypto/bcrypt"
	"github.com/gofiber/fiber/v2/middleware/basicauth"
	_ "github.com/mattn/go-sqlite3"
)

type CreditCard struct {
	CreditCardNumber string `json:"credit_card"`
	PhoneNumber      string `json:"phone"`
}

type PhoneNumbers struct {
	PhoneNumbers []string `json:"phone_numbers"`
}

type Response struct {
	CardNumbers []string `json:"card_numbers"`
}

var db *sql.DB

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		fmt.Println(err)
		return
	}
	defer db.Close()

	app := fiber.New()

	authConfig := basicauth.Config{
		Users: map[string]string{
			os.Getenv("APP_SECRET"): "admin",
		},
	}

	app.Use(basicauth.New(authConfig))

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	app.Listen(":5000")
}

func associateCard(c *fiber.Ctx) error {
	var card CreditCard

	err := c.BodyParser(&card)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	hashedCardNumber, err := bcrypt.GenerateFromPassword([]byte(card.CreditCardNumber), bcrypt.DefaultCost)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	_, err = db.Exec(`INSERT INTO credit_cards (credit_card, phone) VALUES (?, ?)`, hashedCardNumber, card.PhoneNumber)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.SendStatus(fiber.StatusCreated)
}

func retrieveCards(c *fiber.Ctx) error {
	var phones PhoneNumbers

	err := c.BodyParser(&phones)
	if err != nil {
		return c.SendStatus(fiber.StatusBadRequest)
	}

	rows, err := db.Query(`SELECT credit_card FROM credit_cards WHERE phone IN (?)`, phones.PhoneNumbers)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer rows.Close()

	var cards []string
	for rows.Next() {
		var card string
		err = rows.Scan(&card)
		if err != nil {
			return c.SendStatus(fiber.StatusInternalServerError)
		}
		cards = append(cards, card)
	}

	if err = rows.Err(); err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.Status(fiber.StatusOK).JSON(Response{CardNumbers: cards})
}