<CODE>
package main

import (
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
	emailRegex := regexp.MustCompile(`From:.*?<([^>]+)>|From:\s*([^\s<]+@[^\s>]+)`)
	matches := emailRegex.FindStringSubmatch(emailContent)
	
	if len(matches) > 1 {
		if matches[1] != "" {
			return matches[1]
		}
		if len(matches) > 2 && matches[2] != "" {
			return matches[2]
		}
	}
	
	return ""
}

func containsUnsubscribeKeywords(emailContent string) bool {
	lowerContent := strings.ToLower(emailContent)
	
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"opt-out",
		"take me off",
		"cancel subscription",
	}
	
	for _, keyword := range keywords {
		if strings.Contains(lowerContent, keyword) {
			return true
		}
	}
	
	return false
}

func decideUnsubscribeHandler(c *fiber.Ctx) error {
	emailContent := string(c.Body())
	
	if emailContent == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Empty request body",
		})
	}
	
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
	
	app.Post("/decideUnsubscribe", decideUnsubscribeHandler)
	
	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>