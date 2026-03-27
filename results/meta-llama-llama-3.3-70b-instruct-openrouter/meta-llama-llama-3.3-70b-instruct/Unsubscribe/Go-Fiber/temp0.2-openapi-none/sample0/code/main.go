package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/decideUnsubscribe", func(c *fiber.Ctx) error {
		body := c.Body()
		email, unsubscribe := decideUnsubscribe(body)
		return c.JSON(fiber.Map{
			"email":      email,
			"unsubscribe": unsubscribe,
		})
	})

	log.Fatal(app.Listen(":5000"))
}

func decideUnsubscribe(emailBody []byte) (string, bool) {
	scanner := bufio.NewScanner(bytes.NewReader(emailBody))
	var email string
	var unsubscribe bool
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "From: ") {
			email = strings.TrimSpace(strings.Split(line, ":")[1])
		}
		if strings.Contains(strings.ToLower(line), "unsubscribe") ||
			strings.Contains(strings.ToLower(line), "remove me") ||
			strings.Contains(strings.ToLower(line), "deregister me") ||
			strings.Contains(strings.ToLower(line), "stop sending me") ||
			strings.Contains(strings.ToLower(line), "delete me") {
			unsubscribe = true
		}
	}
	if email == "" {
		re := regexp.MustCompile(`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`)
		matches := re.FindAllString(string(emailBody), -1)
		if len(matches) > 0 {
			email = matches[0]
		}
	}
	return email, unsubscribe
}