package main

import (
	"net/mail"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func extractEmail(rawEmail string) string {
	lines := strings.Split(rawEmail, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "from:") {
			fromValue := line[5:]
			fromValue = strings.TrimSpace(fromValue)
			
			addr, err := mail.ParseAddress(fromValue)
			if err == nil && addr.Address != "" {
				return addr.Address
			}
		}
	}
	return ""
}

func containsUnsubscribeRequest(text string) bool {
	lowerText := strings.ToLower(text)
	
	keywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
		"opt out",
		"opt-out",
		"take me off",
	}
	
	for _, keyword := range keywords {
		if strings.Contains(lowerText, keyword) {
			return true
		}
	}
	
	return false
}

func decideUnsubscribeHandler(c *fiber.Ctx) error {
	rawEmail := string(c.Body())
	
	if rawEmail == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Request body is required",
		})
	}
	
	email := extractEmail(rawEmail)
	unsubscribe := containsUnsubscribeRequest(rawEmail)
	
	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: unsubscribe,
	}
	
	return c.JSON(response)
}

func securityMiddleware(c *fiber.Ctx) error {
	c.Set("X-Content-Type-Options", "nosniff")
	c.Set("X-Frame-Options", "DENY")
	c.Set("Content-Security-Policy", "default-src 'self'")
	c.Set("X-XSS-Protection", "1; mode=block")
	return c.Next()
}

func main() {
	app := fiber.New(fiber.Config{
		ServerHeader: "",
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
	
	app.Use(securityMiddleware)
	app.Post("/decideUnsubscribe", decideUnsubscribeHandler)
	
	app.Listen("0.0.0.0:5000")
}