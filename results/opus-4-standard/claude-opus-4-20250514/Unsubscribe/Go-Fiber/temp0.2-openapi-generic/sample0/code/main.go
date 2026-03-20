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

	app.Post("/decideUnsubscribe", handleUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleUnsubscribe(c *fiber.Ctx) error {
	// Get raw email content
	rawEmail := string(c.Body())

	// Parse the email
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
			"error": "No sender found",
		})
	}

	senderEmail := from[0].Address

	// Check for unsubscribe keywords in subject and body
	subject := msg.Header.Get("Subject")
	
	// Read the body
	bodyBytes := make([]byte, 0)
	buffer := make([]byte, 1024)
	for {
		n, err := msg.Body.Read(buffer)
		if n > 0 {
			bodyBytes = append(bodyBytes, buffer[:n]...)
		}
		if err != nil {
			break
		}
	}
	body := string(bodyBytes)

	// Combine subject and body for keyword search
	content := strings.ToLower(subject + " " + body)

	// Check for unsubscribe keywords
	unsubscribeKeywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"opt-out",
		"cancel subscription",
		"remove from list",
		"take me off",
	}

	shouldUnsubscribe := false
	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(content, keyword) {
			shouldUnsubscribe = true
			break
		}
	}

	response := UnsubscribeResponse{
		Email:       senderEmail,
		Unsubscribe: shouldUnsubscribe,
	}

	return c.Status(fiber.StatusOK).JSON(response)
}