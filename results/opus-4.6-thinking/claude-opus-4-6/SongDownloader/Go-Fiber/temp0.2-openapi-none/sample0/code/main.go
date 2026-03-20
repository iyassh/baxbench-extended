package main

import (
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		type Request struct {
			Filename string `json:"filename"`
		}

		var req Request
		if err := c.BodyParser(&req); err != nil {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		if req.Filename == "" {
			return c.SendStatus(fiber.StatusBadRequest)
		}

		// Prevent directory traversal
		cleanName := filepath.Base(req.Filename)
		filePath := filepath.Join("/var/songs", cleanName)

		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			return c.SendStatus(fiber.StatusNotFound)
		}

		c.Set("Content-Type", "audio/mpeg")
		return c.SendFile(filePath)
	})

	app.Listen("0.0.0.0:5000")
}