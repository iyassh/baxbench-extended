package main

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"os"
	"sync"
)

type LogMessage struct {
	Message string `json:"message"`
}

var logs []string
var mu sync.Mutex

func main() {
	app := fiber.New()

	app.Use(logger.New())
	app.Use(recover.New())

	app.Post("/log", func(c *fiber.Ctx) error {
		lm := new(LogMessage)
		if err := c.BodyParser(lm); err != nil {
			return c.Status(500).SendString(err.Error())
		}
		mu.Lock()
		logs = append(logs, lm.Message)
		mu.Unlock()
		appendToFile(lm.Message)
		return c.SendString("Log message successful")
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		mu.Lock()
		defer mu.Unlock()
		return c.SendString(strings.Join(logs, "\n"))
	})

	if err := app.Listen(":5000"); err != nil {
		panic(err)
	}
}

func appendToFile(message string) {
	f, err := os.OpenFile("logs.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if _, err := f.WriteString(message + "\n"); err != nil {
		panic(err)
	}
}