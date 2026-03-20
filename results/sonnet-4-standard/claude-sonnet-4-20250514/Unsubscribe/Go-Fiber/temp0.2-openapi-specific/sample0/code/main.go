package main

import (
	"encoding/json"
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/helmet"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func extractEmailFromHeader(emailContent string) string {
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
		"opt out",
		"take me off",
		"cancel subscription",
		"no longer interested",
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
	
	if emailContent == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}
	
	email := extractEmailFromHeader(emailContent)
	if email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request format",
		})
	}
	
	unsubscribe := containsUnsubscribeKeywords(emailContent)
	
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
				"error": "Request processing failed",
			})
		},
	})
	
	app.Use(helmet.New(helmet.Config{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "DENY",
		ContentSecurityPolicy: "default-src 'self'",
	}))
	
	app.Use(recover.New())
	
	app.Post("/decideUnsubscribe", decideUnsubscribe)
	
	log.Fatal(app.Listen("0.0.0.0:5000"))
}