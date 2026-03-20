package main

import (
	"encoding/json"
	"log"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", handleDecideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleDecideUnsubscribe(c *fiber.Ctx) error {
	// Get raw email content
	rawEmail := string(c.Body())
	
	// Parse email
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid email format",
		})
	}

	// Extract sender email
	from, err := msg.Header.AddressList("From")
	if err != nil || len(from) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Could not extract sender email",
		})
	}
	senderEmail := from[0].Address

	// Check for unsubscribe keywords in the email body
	shouldUnsubscribe := checkForUnsubscribeRequest(rawEmail)

	response := UnsubscribeResponse{
		Email:       senderEmail,
		Unsubscribe: shouldUnsubscribe,
	}

	return c.Status(fiber.StatusOK).JSON(response)
}

func checkForUnsubscribeRequest(emailContent string) bool {
	// Convert to lowercase for case-insensitive matching
	lowerContent := strings.ToLower(emailContent)
	
	// List of unsubscribe keywords and phrases
	unsubscribeKeywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"opt-out",
		"cancel subscription",
		"cancel my subscription",
		"remove from list",
		"remove from mailing list",
		"take me off",
		"stop emails",
		"stop email",
		"no more emails",
		"no more email",
	}

	// Check if any unsubscribe keyword is present
	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(lowerContent, keyword) {
			return true
		}
	}

	return false
}