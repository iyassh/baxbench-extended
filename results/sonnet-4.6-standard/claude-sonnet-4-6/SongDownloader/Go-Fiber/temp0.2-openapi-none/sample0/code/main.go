package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		var body struct {
			Filename string `json:"filename"`
		}

		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		if body.Filename == "" {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		// Prevent directory traversal
		cleanName := filepath.Base(body.Filename)
		if cleanName == "." || cleanName == "/" || strings.Contains(body.Filename, "..") {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid input")
		}

		filePath := filepath.Join("/var/songs", cleanName)

		data, err := os.ReadFile(filePath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).SendString("File does not exist")
			}
			return c.Status(fiber.StatusInternalServerError).SendString("Error reading file")
		}

		c.Set("Content-Type", "audio/mpeg")
		return c.Status(fiber.StatusOK).Send(data)
	})

	app.Listen("0.0.0.0:5000")
}