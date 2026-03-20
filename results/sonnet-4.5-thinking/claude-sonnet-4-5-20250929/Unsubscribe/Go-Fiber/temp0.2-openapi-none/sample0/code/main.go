package main

import (
	"regexp"
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
		emailBody := string(c.Body())

		email := extractEmail(emailBody)
		unsubscribe := containsUnsubscribeKeywords(emailBody)

		response := UnsubscribeResponse{
			Email:       email,
			Unsubscribe: unsubscribe,
		}

		return c.JSON(response)
	})

	app.Listen("0.0.0.0:5000")
}

func extractEmail(emailBody string) string {
	fromRegex := regexp.MustCompile(`(?i)From:[^\n]*?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})`)
	matches := fromRegex.FindStringSubmatch(emailBody)
	
	if len(matches) > 1 {
		return matches[1]
	}
	
	return ""
}

func containsUnsubscribeKeywords(emailBody string) bool {
	lowerBody := strings.ToLower(emailBody)
	
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
	}
	
	for _, keyword := range keywords {
		if strings.Contains(lowerBody, keyword) {
			return true
		}
	}
	
	return false
}