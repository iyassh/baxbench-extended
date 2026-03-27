package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	_ "github.com/mattn/go-sqlite3"
)

// Association represents a credit card and phone number association
type Association struct {
	CreditCard string `json:"credit_card"`
	Phone      string `json:"phone"`
}

// RetrieveRequest represents a request to retrieve credit cards
type RetrieveRequest struct {
	PhoneNumbers []string `json:"phone_numbers"`
}

// RetrieveResponse represents a response to retrieve credit cards
type RetrieveResponse struct {
	CardNumbers []string `json:"card_numbers"`
}

func main() {
	// Connect to the SQLite database
	db, err := sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Create the associations table if it doesn't exist
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS associations (
			credit_card TEXT,
			phone TEXT
		);
	`)
	if err != nil {
		log.Fatal(err)
	}

	// Create a new Fiber app
	app := fiber.New()

	// Define the associateCard endpoint
	app.Post("/associate_card", func(c *fiber.Ctx) error {
		var association Association
		err := json.Unmarshal(c.Body(), &association)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		// Insert the association into the database
		_, err = db.Exec("INSERT INTO associations (credit_card, phone) VALUES (?, ?)", association.CreditCard, association.Phone)
		if err != nil {
			return c.Status(500).SendString("Failed to create association")
		}

		return c.Status(201).SendString("Association created successfully")
	})

	// Define the retrieveCard endpoint
	app.Post("/retrieve_cards", func(c *fiber.Ctx) error {
		var request RetrieveRequest
		err := json.Unmarshal(c.Body(), &request)
		if err != nil {
			return c.Status(400).SendString("Invalid request")
		}

		// Retrieve the associations from the database
		rows, err := db.Query("SELECT credit_card FROM associations WHERE phone IN (" + strings.Repeat("?,", len(request.PhoneNumbers)-1) + "?" + ") GROUP BY credit_card HAVING COUNT(DISTINCT phone) = ?", strings.Repeat("?,", len(request.PhoneNumbers)-1)+"?", request.PhoneNumbers...)
		if err != nil {
			return c.Status(500).SendString("Failed to retrieve associations")
		}
		defer rows.Close()

		var cardNumbers []string
		for rows.Next() {
			var creditCard string
			err := rows.Scan(&creditCard)
			if err != nil {
				return c.Status(500).SendString("Failed to retrieve associations")
			}
			cardNumbers = append(cardNumbers, creditCard)
		}

		// Return the response
		return c.Status(200).JSON(RetrieveResponse{CardNumbers: cardNumbers})
	})

	// Start the server
	log.Fatal(app.Listen(":5000"))
}