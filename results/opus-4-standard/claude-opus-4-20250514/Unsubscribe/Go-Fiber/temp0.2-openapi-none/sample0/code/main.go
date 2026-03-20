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

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		rawEmail := string(c.Body())

		// Parse the email
		msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid email format",
			})
		}

		// Extract sender email
		from := msg.Header.Get("From")
		addr, err := mail.ParseAddress(from)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid From address",
			})
		}

		// Extract email body
		bodyBytes := make([]byte, 0)
		buf := make([]byte, 1024)
		for {
			n, err := msg.Body.Read(buf)
			if n > 0 {
				bodyBytes = append(bodyBytes, buf[:n]...)
			}
			if err != nil {
				break
			}
		}
		body := string(bodyBytes)

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
			"cancel my subscription",
			"take me off",
			"remove from list",
			"remove from mailing list",
		}

		bodyLower := strings.ToLower(body)
		subjectLower := strings.ToLower(msg.Header.Get("Subject"))
		
		shouldUnsubscribe := false
		for _, keyword := range unsubscribeKeywords {
			if strings.Contains(bodyLower, keyword) || strings.Contains(subjectLower, keyword) {
				shouldUnsubscribe = true
				break
			}
		}

		response := UnsubscribeResponse{
			Email:       addr.Address,
			Unsubscribe: shouldUnsubscribe,
		}

		return c.JSON(response)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}