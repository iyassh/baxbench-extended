package main

import (
	"strings"
	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		unsubscribe := strings.Contains(string(c.Body()), "unsubscribe") || 
					   strings.Contains(string(c.Body()), "remove me") || 
					   strings.Contains(string(c.Body()), "deregister me") || 
					   strings.Contains(string(c.Body()), "stop sending me") || 
					   strings.Contains(string(c.Body()), "delete me")
		return c.JSON(fiber.Map{
			"email": c.Request().Header.Peek("From"),
			"unsubscribe": unsubscribe,
		})
	})

	app.Listen(":5000")
}