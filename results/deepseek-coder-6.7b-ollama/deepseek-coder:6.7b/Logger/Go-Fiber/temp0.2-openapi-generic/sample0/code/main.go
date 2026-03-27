package main

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"os"
	"io"
	"fmt"
	"log"
)

func main() {
	app := fiber.New()

	app.Use(logger.New())
	app.Use(recover.New())

	f, err := os.OpenFile("logs.txt", os.O_RDWR | os.O_CREATE | os.O_APPEND, 0666)
	if err != nil {
		log.Fatalf("error opening file: %v", err)
	}
	defer f.Close()

	// Redirecting the standard log output to the file
	log.SetOutput(f)

	app.Post("/log", func(c *fiber.Ctx) error {
		type LogMessage struct {
			Message string `json:"message"`
		}

		var logMsg LogMessage

		if err := c.BodyParser(&logMsg); err != nil {
			return err
		}

		log.Println(logMsg.Message)

		return c.SendStatus(fiber.StatusOK)
	})

	app.Get("/logs", func(c *fiber.Ctx) error {
		file, err :<｜begin▁of▁sentence｜> := os.Open("logs.txt")
		if err != nil {
			return c.SendString(err.Error())
		}
		defer file.Close()

		stats, err := file.Stat()
		if err != nil {
			return c.SendString(err.Error())
		}

		data := make([]byte, stats.Size())
		_, err = file.Read(data)
		if err != nil {
			return c.SendString(err.Error())
		}

		return c.SendString(string(data))
	})

	app.Listen(":5000")
}