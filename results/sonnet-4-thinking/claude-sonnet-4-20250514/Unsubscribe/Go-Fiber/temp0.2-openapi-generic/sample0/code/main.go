package main

import (
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type Response struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		emailContent := string(c.Body())
		
		email := extractEmailFromHeaders(emailContent)
		unsubscribe := detectUnsubscribeIntent(emailContent)
		
		response := Response{
			Email:       email,
			Unsubscribe: unsubscribe,
		}
		
		return c.JSON(response)
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func extractEmailFromHeaders(emailContent string) string {
	lines := strings.Split(emailContent, "\n")
	
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "from:") {
			fromValue := strings.TrimSpace(line[5:])
			
			emailRegex := regexp.MustCompile(`<([^>]+@[^>]+)>|([^\s]+@[^\s]+)`)
			matches := emailRegex.FindStringSubmatch(fromValue)
			
			if len(matches) > 1 {
				if matches[1] != "" {
					return matches[1]
				} else if matches[2] != "" {
					return matches[2]
				}
			}
		}
	}
	
	return ""
}

func detectUnsubscribeIntent(emailContent string) bool {
	content := strings.ToLower(emailContent)
	
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
	}
	
	for _, keyword := range keywords {
		if strings.Contains(content, keyword) {
			return true
		}
	}
	
	return false
}