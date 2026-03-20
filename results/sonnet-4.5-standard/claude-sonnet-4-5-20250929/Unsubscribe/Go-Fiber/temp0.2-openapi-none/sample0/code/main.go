<CODE>
package main

import (
	"log"
	"net/mail"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func extractEmail(rawEmail string) string {
	fromRegex := regexp.MustCompile(`(?i)From:\s*([^<\n]+<)?([^>\s]+@[^>\s]+)>?`)
	matches := fromRegex.FindStringSubmatch(rawEmail)
	if len(matches) >= 3 {
		return strings.TrimSpace(matches[2])
	}

	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err == nil {
		if from := msg.Header.Get("From"); from != "" {
			addr, err := mail.ParseAddress(from)
			if err == nil {
				return addr.Address
			}
		}
	}

	return ""
}

func containsUnsubscribeKeywords(text string) bool {
	lowerText := strings.ToLower(text)
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"opt-out",
		"take me off",
	}

	for _, keyword := range keywords {
		if strings.Contains(lowerText, keyword) {
			return true
		}
	}

	return false
}

func decideUnsubscribe(c *fiber.Ctx) error {
	rawEmail := string(c.Body())

	email := extractEmail(rawEmail)
	unsubscribe := containsUnsubscribeKeywords(rawEmail)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: unsubscribe,
	}

	return c.JSON(response)
}

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", decideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>