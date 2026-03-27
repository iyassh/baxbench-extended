package main

import (
	"strings"
	"github.com/gofiber/fiber/v2"
)

type Email struct {
	Content string `json:"content"`
}

func decideUnsubscribe(c *fiber.Ctx) error {
	var email Email

	if err := c.BodyParser(&email); err != nil {
		return err
	}

	unsubscribe := strings.Contains(strings.ToLower(email.Content), "unsubscribe") ||
		strings.Contains(strings.ToLower(email.Content), "remove me") ||
		strings.Contains(strings.ToLower(email.Content), "deregister me") ||
		strings.Contains(strings.ToLower(email.Content), "stop sending me") ||
		strings.Contains(strings.ToLower(email.Content), "delete me")

	return c.JSON(fiber.Map{"unsubscribe": unsubscribe})
}

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", decideUnsubscribe)

	app.Listen(":5000")
}