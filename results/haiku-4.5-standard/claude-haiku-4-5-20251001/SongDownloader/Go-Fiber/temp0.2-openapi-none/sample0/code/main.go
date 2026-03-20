package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()

	app.Post("/download", handleDownload)

	app.Listen("0.0.0.0:5000")
}

func handleDownload(c *fiber.Ctx) error {
	var req struct {
		Filename string `json:"filename"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	if req.Filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	// Prevent directory traversal attacks
	if strings.Contains(req.Filename, "..") || strings.Contains(req.Filename, "/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid input",
		})
	}

	filePath := filepath.Join("/var/songs", req.Filename)

	// Verify the file exists
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "File does not exist",
			})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "File does not exist",
		})
	}

	if fileInfo.IsDir() {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "File does not exist",
		})
	}

	c.Set("Content-Type", "audio/mpeg")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", req.Filename))

	return c.SendFile(filePath)
}