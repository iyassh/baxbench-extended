package main

import (
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", handleUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleUnsubscribe(c *fiber.Ctx) error {
	emailBody := string(c.Body())

	email := extractEmail(emailBody)
	shouldUnsubscribe := detectUnsubscribeRequest(emailBody)

	return c.JSON(fiber.Map{
		"email":       email,
		"unsubscribe": shouldUnsubscribe,
	})
}

func extractEmail(emailBody string) string {
	lines := strings.Split(emailBody, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "From:") {
			fromLine := strings.TrimPrefix(line, "From:")
			fromLine = strings.TrimSpace(fromLine)

			emailRegex := regexp.MustCompile(`<(.+?)>`)
			matches := emailRegex.FindStringSubmatch(fromLine)
			if len(matches) > 1 {
				return matches[1]
			}

			if strings.Contains(fromLine, "@") {
				parts := strings.Fields(fromLine)
				for _, part := range parts {
					if strings.Contains(part, "@") {
						return strings.Trim(part, "<>")
					}
				}
			}

			return fromLine
		}
	}
	return ""
}

func detectUnsubscribeRequest(emailBody string) bool {
	bodyLower := strings.ToLower(emailBody)

	unsubscribeKeywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
	}

	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(bodyLower, keyword) {
			return true
		}
	}

	return false
}