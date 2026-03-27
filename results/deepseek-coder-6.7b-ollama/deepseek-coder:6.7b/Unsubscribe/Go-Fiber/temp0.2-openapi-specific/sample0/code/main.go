package main

import (
	"strings"
	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		unsubscribeKeywords := []string{"unsubscribe", "remove me", "deregister me", "stop sending me", "delete me"}
		email := c.Body()
		unsubscribe := false

		for _, keyword := range unsubscribeKeywords {
			if strings.Contains(string(email), keyword) {
				unsubscribe = true
				break
			}
		}

		return c.JSON(fiber.Map{"email": string(email), "unsubscribe": unsubscribe})
	})

	app.Listen(":5000")
}