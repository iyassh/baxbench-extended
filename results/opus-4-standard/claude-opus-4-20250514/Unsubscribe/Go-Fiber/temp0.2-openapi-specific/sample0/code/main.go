package main

import (
	"encoding/json"
	"log"
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred processing your request",
			})
		},
	})

	// Security middleware
	app.Use(helmet.New())
	app.Use(recover.New())

	// Custom security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/decideUnsubscribe", handleDecideUnsubscribe)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}

func handleDecideUnsubscribe(c *fiber.Ctx) error {
	// Get raw email content
	rawEmail := string(c.Body())
	
	if len(rawEmail) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Request body is empty",
		})
	}

	// Parse email
	msg, err := mail.ReadMessage(strings.NewReader(rawEmail))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid email format",
		})
	}

	// Extract sender email
	from, err := msg.Header.AddressList("From")
	if err != nil || len(from) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Unable to extract sender email",
		})
	}

	senderEmail := from[0].Address

	// Check for unsubscribe keywords
	unsubscribe := checkForUnsubscribeRequest(rawEmail)

	response := UnsubscribeResponse{
		Email:       senderEmail,
		Unsubscribe: unsubscribe,
	}

	return c.JSON(response)
}

func checkForUnsubscribeRequest(emailContent string) bool {
	// Convert to lowercase for case-insensitive matching
	lowerContent := strings.ToLower(emailContent)

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
		"remove from list",
		"take me off",
		"no more emails",
		"stop emails",
	}

	// Check if any unsubscribe keyword is present
	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(lowerContent, keyword) {
			return true
		}
	}

	return false
}