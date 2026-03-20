package main

import (
	"encoding/json"
	"log"
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

	app.Post("/decideUnsubscribe", decideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func decideUnsubscribe(c *fiber.Ctx) error {
	rawEmail := string(c.Body())

	// Extract email address from the From header
	email := extractEmailAddress(rawEmail)

	// Check if the email contains unsubscribe keywords
	shouldUnsubscribe := containsUnsubscribeKeywords(rawEmail)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: shouldUnsubscribe,
	}

	return c.JSON(response)
}

func extractEmailAddress(rawEmail string) string {
	// Look for From: header
	fromRegex := regexp.MustCompile(`(?i)From:\s*(?:.*?<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?`)
	matches := fromRegex.FindStringSubmatch(rawEmail)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

func containsUnsubscribeKeywords(rawEmail string) bool {
	// Extract the actual message content (after headers, looking for plain text content)
	contentStartIndex := strings.Index(rawEmail, "Content-Type:text/plain")
	if contentStartIndex == -1 {
		// If no plain text, check the entire email
		contentStartIndex = 0
	}
	
	content := strings.ToLower(rawEmail[contentStartIndex:])
	
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
		"stop emails",
		"stop email",
		"remove from list",
		"take me off",
		"remove my email",
		"delete my email",
	}
	
	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(content, keyword) {
			return true
		}
	}
	
	return false
}