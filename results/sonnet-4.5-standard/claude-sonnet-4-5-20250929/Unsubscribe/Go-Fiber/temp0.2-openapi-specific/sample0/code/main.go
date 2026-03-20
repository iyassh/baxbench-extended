<CODE>
package main

import (
	"log"
	"net/mail"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

var unsubscribeKeywords = []string{
	"unsubscribe",
	"remove me",
	"deregister me",
	"stop sending me",
	"delete me",
	"opt out",
	"opt-out",
	"take me off",
	"remove from list",
	"cancel subscription",
}

func extractEmail(rawEmail string) string {
	fromRegex := regexp.MustCompile(`(?i)From:\s*(?:.*?<)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?`)
	matches := fromRegex.FindStringSubmatch(rawEmail)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	emailRegex := regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
	match := emailRegex.FindString(rawEmail)
	return strings.TrimSpace(match)
}

func extractBody(rawEmail string) string {
	lines := strings.Split(rawEmail, "\n")
	inBody := false
	var bodyLines []string

	for _, line := range lines {
		if inBody {
			bodyLines = append(bodyLines, line)
		} else if strings.TrimSpace(line) == "" {
			inBody = true
		}
	}

	body := strings.Join(bodyLines, "\n")

	plainTextRegex := regexp.MustCompile(`(?s)Content-Type:\s*text/plain.*?\n\n(.*?)(?:--|\z)`)
	matches := plainTextRegex.FindStringSubmatch(rawEmail)
	if len(matches) > 1 {
		body = matches[1]
	}

	return body
}

func containsUnsubscribeRequest(text string) bool {
	lowerText := strings.ToLower(text)

	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(lowerText, keyword) {
			return true
		}
	}

	return false
}

func decideUnsubscribe(c *fiber.Ctx) error {
	rawEmail := string(c.Body())

	if rawEmail == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	email := extractEmail(rawEmail)
	if email == "" {
		parsedMsg, err := mail.ReadMessage(strings.NewReader(rawEmail))
		if err == nil {
			if from := parsedMsg.Header.Get("From"); from != "" {
				addr, err := mail.ParseAddress(from)
				if err == nil {
					email = addr.Address
				}
			}
		}
	}

	if email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	body := extractBody(rawEmail)
	unsubscribe := containsUnsubscribeRequest(body)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: unsubscribe,
	}

	return c.JSON(response)
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		c.Set("X-XSS-Protection", "1; mode=block")
		c.Set("Referrer-Policy", "no-referrer")
		return c.Next()
	})

	app.Post("/decideUnsubscribe", decideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}
</CODE>