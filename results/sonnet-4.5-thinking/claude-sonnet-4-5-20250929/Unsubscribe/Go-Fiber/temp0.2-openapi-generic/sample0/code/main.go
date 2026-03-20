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

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", handleUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleUnsubscribe(c *fiber.Ctx) error {
	emailBody := string(c.Body())
	email := extractEmail(emailBody)
	unsubscribe := containsUnsubscribeKeywords(emailBody)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: unsubscribe,
	}

	return c.JSON(response)
}

func extractEmail(emailBody string) string {
	lines := strings.Split(emailBody, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "from:") {
			emailRegex := regexp.MustCompile(`<([^>]+)>|([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})`)
			matches := emailRegex.FindStringSubmatch(line)
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

func containsUnsubscribeKeywords(emailBody string) bool {
	bodyLower := strings.ToLower(emailBody)
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
	}

	for _, keyword := range keywords {
		if strings.Contains(bodyLower, keyword) {
			return true
		}
	}

	return false
}