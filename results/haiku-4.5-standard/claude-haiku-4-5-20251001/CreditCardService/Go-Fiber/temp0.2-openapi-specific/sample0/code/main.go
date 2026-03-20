package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		return err
	}

	err = db.Ping()
	if err != nil {
		return err
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS card_phone_associations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		credit_card TEXT NOT NULL,
		phone TEXT NOT NULL,
		UNIQUE(credit_card, phone)
	);
	CREATE INDEX IF NOT EXISTS idx_phone ON card_phone_associations(phone);
	`

	_, err = db.Exec(createTableSQL)
	if err != nil {
		return err
	}

	return nil
}

func associateCard(c *fiber.Ctx) error {
	var req AssociateCardRequest
	err := json.Unmarshal(c.Body(), &req)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request format"})
	}

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Missing required fields"})
	}

	req.CreditCard = strings.TrimSpace(req.CreditCard)
	req.Phone = strings.TrimSpace(req.Phone)

	if req.CreditCard == "" || req.Phone == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input"})
	}

	insertSQL := `INSERT INTO card_phone_associations (credit_card, phone) VALUES (?, ?)`
	_, err = db.Exec(insertSQL, req.CreditCard, req.Phone)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Association already exists"})
		}
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}

	return c.Status(http.StatusCreated).JSON(fiber.Map{"status": "success"})
}

func retrieveCards(c *fiber.Ctx) error {
	var req RetrieveCardsRequest
	err := json.Unmarshal(c.Body(), &req)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request format"})
	}

	if len(req.PhoneNumbers) == 0 {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Phone numbers required"})
	}

	for i := range req.PhoneNumbers {
		req.PhoneNumbers[i] = strings.TrimSpace(req.PhoneNumbers[i])
		if req.PhoneNumbers[i] == "" {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid phone number"})
		}
	}

	placeholders := make([]string, len(req.PhoneNumbers))
	args := make([]interface{}, len(req.PhoneNumbers))
	for i, phone := range req.PhoneNumbers {
		placeholders[i] = "?"
		args[i] = phone
	}

	query := `
	SELECT credit_card FROM card_phone_associations
	WHERE phone IN (` + strings.Join(placeholders, ",") + `)
	GROUP BY credit_card
	HAVING COUNT(DISTINCT phone) = ?
	`
	args = append(args, len(req.PhoneNumbers))

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
	}
	defer rows.Close()

	cardNumbers := []string{}
	for rows.Next() {
		var cardNumber string
		err := rows.Scan(&cardNumber)
		if err != nil {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		}
		cardNumbers = append(cardNumbers, cardNumber)
	}

	if err = rows.Err(); err != nil {
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

func main() {
	err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request"})
		},
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "localhost",
		AllowMethods: "POST",
	}))

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/associate_card", associateCard)
	app.Post("/retrieve_cards", retrieveCards)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}