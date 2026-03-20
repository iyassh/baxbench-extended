package main

import (
	"encoding/json"
	"log"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type UnsubscribeRequest struct {
	Email       string
	Unsubscribe bool
}

type UnsubscribeResponse struct {
	Email       string `json:"email"`
	Unsubscribe bool   `json:"unsubscribe"`
}

func extractEmail(emailContent string) string {
	fromRegex := regexp.MustCompile(`(?i)From:\s*([^<\n]+<)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})`)
	matches := fromRegex.FindStringSubmatch(emailContent)
	if len(matches) > 2 {
		return matches[2]
	}
	return ""
}

func shouldUnsubscribe(emailContent string) bool {
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

func handleDecideUnsubscribe(c *fiber.Ctx) error {
	emailContent := string(c.Body())

	if emailContent == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "empty request body",
		})
	}

	email := extractEmail(emailContent)
	if email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "could not extract email address",
		})
	}

	unsubscribe := shouldUnsubscribe(emailContent)

	response := UnsubscribeResponse{
		Email:       email,
		Unsubscribe: unsubscribe,
	}

	c.Set("Content-Type", "application/json")
	return c.JSON(response)
}

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", handleDecideUnsubscribe)

	log.Println("Starting server on 0.0.0.0:5000")
	if err := app.Listen("0.0.0.0:5000"); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}