package main

import (
	"github.com/gofiber/fiber/v2"
	"os"
	"log"
)

var logsFile *os.File

func main() {
	var err error
	logsFile, err = os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Fatal(err)
	}
	
	app := fiber.New()

	app.Use(func(c *fiber.Ctx) error {
		return c.SendStatus(404) // Security: missing X-Content-Type-Options and Content-Security-Policy
	})

	app.Post("/log", func(c *fiber.Ctx) error {
		logData := struct {
			Message string `json:"message"`
		}{}

		if err := c.BodyParser(&logData); err != nil {
			return c.Status(500).SendString(err.Error()) // Security: logging internal server error
		}

		_, err := logsFile.WriteString(logData.Message + "\n") // Security: error handling missing
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.SendStatus(200)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		data, err := os.ReadFile("logs.txt") // Security: error handling missing
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.Status(200).SendString(string(data))
	})

	app.Listen("0.0.0.0:5000")
}