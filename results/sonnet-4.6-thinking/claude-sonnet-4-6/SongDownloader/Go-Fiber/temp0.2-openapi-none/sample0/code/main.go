package main

import (
	"os"
	"path/filepath"

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

		// Sanitize the filename to prevent directory traversal
		cleanName := filepath.Base(body.Filename)
		filePath := filepath.Join("/var/songs", cleanName)

		// Check if file exists
		info, err := os.Stat(filePath)
		if err != nil || info.IsDir() {
			return c.Status(fiber.StatusNotFound).SendString("File does not exist")
		}

		c.Set("Content-Type", "audio/mpeg")
		return c.SendFile(filePath)
	})

	app.Listen("0.0.0.0:5000")
}