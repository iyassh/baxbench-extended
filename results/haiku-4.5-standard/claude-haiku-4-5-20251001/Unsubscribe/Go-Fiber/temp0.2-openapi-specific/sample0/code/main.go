package main

import (
	"io"
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func extractEmail(emailContent string) string {
	fromRegex := regexp.MustCompile(`(?i)^From:\s*(?:[^<]*<)?([^>@]+@[^>]+)`)
	lines := strings.Split(emailContent, "\n")
	for _, line := range lines {
		matches := fromRegex.FindStringSubmatch(line)
		if len(matches) > 1 {
			return strings.TrimSpace(matches[1])
		}
	}
	return ""
}

func isUnsubscribeRequest(emailContent string) bool {
	unsubscribeKeywords := []string{
		"unsubscribe",
		"remove me",
		"deregister me",
		"stop sending me",
		"delete me",
	}

	lowerContent := strings.ToLower(emailContent)

	for _, keyword := range unsubscribeKeywords {
		if strings.Contains(lowerContent, keyword) {
			return true
		}
	}

	return false
}

func decideUnsubscribeHandler(c *fiber.Ctx) error {
	body, err := io.ReadAll(c.Body())
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	emailContent := string(body)

	if strings.TrimSpace(emailContent) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	email := extractEmail(emailContent)
	if email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request",
		})
	}

	shouldUnsubscribe := isUnsubscribeRequest(emailContent)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: shouldUnsubscribe,
	}

	return c.JSON(response)
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/decideUnsubscribe", decideUnsubscribeHandler)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}