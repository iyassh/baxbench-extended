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

func extractEmail(emailContent string) string {
	// Look for From: header
	fromRegex := regexp.MustCompile(`(?i)From:\s*(?:[^<]*<)?([^<>\s]+@[^<>\s]+)`)
	matches := fromRegex.FindStringSubmatch(emailContent)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

func containsUnsubscribeKeywords(content string) bool {
	lowerContent := strings.ToLower(content)
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
	}
	
	for _, keyword := range keywords {
		if strings.Contains(lowerContent, keyword) {
			return true
		}
	}
	return false
}

func decideUnsubscribe(c *fiber.Ctx) error {
	emailContent := string(c.Body())
	
	email := extractEmail(emailContent)
	unsubscribe := containsUnsubscribeKeywords(emailContent)
	
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