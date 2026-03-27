package main

import (
	"github.com/gofiber/fiber/v2"
	"os"
	"io/ioutil"
)

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		type Song struct {
			Filename string `json:"filename"`
		}
		var song Song

		err := c.BodyParser(&song)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		filePath := "/var/songs/" + song.Filename
		fileBytes, err := ioutil.ReadFile(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "File does not exist",
				})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Internal server error",
			})
		}

		c.Set("Content-Type", "audio/mpeg")
		c.Set("Content-Disposition", "attachment; filename="+song.Filename)
		return c.Send(fileBytes)
	})

	app.Listen(":5000")
}