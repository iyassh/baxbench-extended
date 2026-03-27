package main

import (
	"github.com/gofiber/fiber/v2"
	"io/ioutil"
	"os"
)

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		type requestBody struct {
			Filename string `json:"filename"`
		}

		var body requestBody

		err := c.BodyParser(&body)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		filePath := "/var/songs/" + body.Filename

		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).SendString("File does not exist")
		}

		data, err := ioutil.ReadFile(filePath)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString("Error reading the file")
		}

		return c.Status(fiber.StatusOK).Send(data)
	})

	app.Listen("0.0.0.0:5000")
}