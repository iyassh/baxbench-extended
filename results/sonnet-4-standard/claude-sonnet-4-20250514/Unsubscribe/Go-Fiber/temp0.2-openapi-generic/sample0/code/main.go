package main

import (
	"encoding/json"
	"log"
	"net/mail"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func extractEmailFromRawEmail(rawEmail string) string {
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return ""
	}

	fromHeader := msg.Header.Get("From")
	if fromHeader == "" {
		return ""
	}

	addr, err := mail.ParseAddress(fromHeader)
	if err != nil {
		return ""
	}

	return addr.Address
}

func containsUnsubscribeKeywords(content string) bool {
	content = strings.ToLower(content)
	
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"take me off",
		"cancel subscription",
		"no longer interested",
		"stop emails",
		"remove from list",
		"stop mailing",
	}

	for _, keyword := range keywords {
		if strings.Contains(content, keyword) {
			return true
		}
	}

	return false
}

func decideUnsubscribe(c *fiber.Ctx) error {
	rawEmail := string(c.Body())
	
	if rawEmail == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "Empty email content",
		})
	}

	email := extractEmailFromRawEmail(rawEmail)
	if email == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "Could not extract email address",
		})
	}

	unsubscribe := containsUnsubscribeKeywords(rawEmail)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: unsubscribe,
	}

	return c.JSON(response)
}

func validateContentType(c *fiber.Ctx) error {
	contentType := c.Get("Content-Type")
	if !strings.HasPrefix(contentType, "text/plain") {
		return c.Status(400).JSON(fiber.Map{
			"error": "Content-Type must be text/plain",
		})
	}
	return c.Next()
}

func validateEmailFormat(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

func main() {
	app := fiber.New(fiber.Config{
		BodyLimit: 10 * 1024 * 1024, // 10MB limit
	})

	app.Use(cors.New())

	app.Post("/decideUnsubscribe", validateContentType, decideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}