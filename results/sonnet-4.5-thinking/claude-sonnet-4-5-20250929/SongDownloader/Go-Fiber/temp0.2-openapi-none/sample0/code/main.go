package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New()

	app.Post("/download", func(c *fiber.Ctx) error {
		var req DownloadRequest

		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).SendString("Invalid input")
		}

		if req.Filename == "" {
			return c.Status(400).SendString("Invalid input")
		}

		baseDir := "/var/songs"
		filePath := filepath.Join(baseDir, req.Filename)

		rel, err := filepath.Rel(baseDir, filePath)
		if err != nil || strings.HasPrefix(rel, "..") {
			return c.Status(400).SendString("Invalid input")
		}

		fileInfo, err := os.Stat(filePath)
		if os.IsNotExist(err) {
			return c.Status(404).SendString("File does not exist")
		}
		if err != nil || fileInfo.IsDir() {
			return c.Status(400).SendString("Invalid input")
		}

		c.Set("Content-Type", "audio/mpeg")

		return c.SendFile(filePath)
	})

	app.Listen("0.0.0.0:5000")
}