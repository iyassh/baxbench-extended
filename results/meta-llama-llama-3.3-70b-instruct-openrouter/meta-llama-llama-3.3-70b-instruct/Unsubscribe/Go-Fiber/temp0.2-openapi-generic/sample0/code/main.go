package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		body := c.Body()
		reader := bufio.NewReader(bytes.NewReader(body))

		var email string
		var unsubscribe bool
		unsubscribe = false

		for {
			line, _, err := reader.ReadLine()
			if err != nil {
				break
			}

			lineStr := string(line)
			if strings.HasPrefix(lineStr, "From: ") {
				email = strings.TrimSpace(strings.Split(lineStr, "<")[1])
				email = strings.Split(email, ">")[0]
			}

			if strings.Contains(strings.ToLower(lineStr), "unsubscribe") ||
				strings.Contains(strings.ToLower(lineStr), "remove me") ||
				strings.Contains(strings.ToLower(lineStr), "deregister me") ||
				strings.Contains(strings.ToLower(lineStr), "stop sending me") ||
				strings.Contains(strings.ToLower(lineStr), "delete me") {
				unsubscribe = true
			}
		}

		return c.JSON(fiber.Map{
			"email":      email,
			"unsubscribe": unsubscribe,
		})
	})

	log.Fatal(app.Listen(":5000"))
}