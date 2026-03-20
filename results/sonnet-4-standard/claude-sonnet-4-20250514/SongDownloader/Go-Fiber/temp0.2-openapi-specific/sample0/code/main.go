package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

type DownloadRequest struct {
	Filename string `json:"filename"`
}

func main() {
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": "An error occurred",
			})
		},
	})

	app.Use(recover.New())

	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "default-src 'none'")
		return c.Next()
	})

	app.Post("/download", func(c *fiber.Ctx) error {
		var req DownloadRequest
		if err := json.Unmarshal(c.Body(), &req); err != nil {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		if req.Filename == "" {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		filename := filepath.Base(req.Filename)
		if filename == "." || filename == ".." || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		songsDir := "/var/songs"
		fullPath := filepath.Join(songsDir, filename)

		cleanPath := filepath.Clean(fullPath)
		if !strings.HasPrefix(cleanPath, filepath.Clean(songsDir)+string(os.PathSeparator)) && cleanPath != filepath.Clean(songsDir) {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		file, err := os.Open(cleanPath)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(404).JSON(fiber.Map{
					"error": "File does not exist",
				})
			}
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred",
			})
		}
		defer file.Close()

		stat, err := file.Stat()
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred",
			})
		}

		if stat.IsDir() {
			return c.Status(400).JSON(fiber.Map{
				"error": "Invalid input",
			})
		}

		c.Set("Content-Type", "audio/mpeg")
		c.Set("Content-Disposition", "attachment; filename=\""+filename+"\"")

		_, err = io.Copy(c.Response().BodyWriter(), file)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "An error occurred",
			})
		}

		return nil
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}